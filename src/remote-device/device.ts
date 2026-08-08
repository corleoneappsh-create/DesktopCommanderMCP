#!/usr/bin/env node

import { RemoteChannel } from './remote-channel.js';
import { DeviceAuthenticator } from './device-authenticator.js';
import { DesktopCommanderIntegration } from './desktop-commander-integration.js';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { captureRemote } from '../utils/capture.js';

export interface MCPDeviceOptions {
    persistSession?: boolean;
}

const DEFAULT_MAX_LOG_CHARS = 2048;
const DEFAULT_CALL_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_RECENT_CALLS = 1024;

export function compactForLog(value: unknown, maxChars = DEFAULT_MAX_LOG_CHARS): string {
    let rendered: string;
    try {
        const serialized = JSON.stringify(value);
        rendered = serialized === undefined ? String(value) : serialized;
    } catch (error: any) {
        return `[unserializable: ${error?.message || String(error)}]`;
    }
    if (rendered.length <= maxChars) return rendered;
    return `${rendered.slice(0, maxChars)}…[truncated ${rendered.length - maxChars} chars]`;
}

export class RemoteCallDeduplicator {
    private active = new Set<string>();
    private completed = new Map<string, number>();

    constructor(
        private ttlMs = DEFAULT_CALL_TTL_MS,
        private maxRecent = DEFAULT_MAX_RECENT_CALLS,
    ) {}

    begin(callId: string, now = Date.now()): boolean {
        this.cleanup(now);
        if (this.active.has(callId) || this.completed.has(callId)) return false;
        this.active.add(callId);
        return true;
    }

    finish(callId: string, now = Date.now()): void {
        this.active.delete(callId);
        this.completed.delete(callId);
        this.completed.set(callId, now);
        this.cleanup(now);
    }

    private cleanup(now: number): void {
        for (const [callId, completedAt] of this.completed) {
            if (now - completedAt >= this.ttlMs) this.completed.delete(callId);
        }
        while (this.completed.size > this.maxRecent) {
            const oldest = this.completed.keys().next().value as string | undefined;
            if (!oldest) break;
            this.completed.delete(oldest);
        }
    }
}

export class MCPDevice {
    private baseServerUrl: string;
    private remoteChannel: RemoteChannel;
    private deviceId?: string;
    private isShuttingDown: boolean;
    private configPath: string;
    private persistSession: boolean;
    private desktop: DesktopCommanderIntegration;
    private callDeduplicator = new RemoteCallDeduplicator();
    private sessionSaveQueue: Promise<void> = Promise.resolve();
    private authSubscription?: { unsubscribe: () => void };

    constructor(options: MCPDeviceOptions = {}) {
        this.baseServerUrl = process.env.MCP_SERVER_URL || 'https://mcp.desktopcommander.app';
        this.remoteChannel = new RemoteChannel();
        this.deviceId = undefined;
        this.isShuttingDown = false;
        this.configPath = path.join(os.homedir(), '.desktop-commander-device', 'device.json');
        this.persistSession = options.persistSession || false;

        // Initialize desktop integration
        this.desktop = new DesktopCommanderIntegration();

        // Graceful shutdown handlers (only set once)
        this.setupShutdownHandlers();
    }

    private setupShutdownHandlers() {
        const handleShutdown = async (signal: string) => {
            if (this.isShuttingDown) {
                console.log(`\n${signal} received, but already shutting down...`);
                // Force exit if we get multiple signals
                process.exit(1);
                return;
            }

            console.log(`\n${signal} received, initiating graceful shutdown...`);

            // Force exit after 5 seconds if graceful shutdown hangs
            const forceExit = setTimeout(() => {
                console.error('\n⚠️ Graceful shutdown timed out, forcing exit...');
                process.exit(1);
            }, 5000);

            try {
                await this.shutdown();
                clearTimeout(forceExit);
                process.exit(0);
            } catch (error) {
                console.error('Error during shutdown:', error);
                await captureRemote('remote_device_shutdown_handler_error', { error });
                process.exit(1);
            }
        };

        // Remove any existing SIGINT/SIGTERM listeners to prevent default behavior
        // process.removeAllListeners('SIGINT');
        // process.removeAllListeners('SIGTERM');

        // Add our custom handlers
        process.on('SIGINT', () => {
            handleShutdown('SIGINT').catch((error) => {
                console.error('Fatal error during shutdown:', error);
                captureRemote('remote_device_shutdown_handler_error', { error, signal: 'SIGINT' }).catch(() => { });
                process.exit(1);
            });
        });

        process.on('SIGTERM', () => {
            handleShutdown('SIGTERM').catch((error) => {
                console.error('Fatal error during shutdown:', error);
                captureRemote('remote_device_shutdown_handler_error', { error, signal: 'SIGTERM' }).catch(() => { });
                process.exit(1);
            });
        });
    }

    async start() {
        try {
            console.log('🚀 Starting MCP Device...');
            if (process.env.DEBUG_MODE === 'true') {
                console.log(`  - 🐞 DEBUG_MODE`);
            }


            // Initialize desktop integration
            await this.desktop.initialize();

            console.log(`⏳ Connecting to Remote MCP ${this.baseServerUrl}`);
            const { supabaseUrl, anonKey } = await this.fetchSupabaseConfig();
            console.log(`   - 🔌 Connected to Remote MCP`);

            // Initialize Remote Channel
            this.remoteChannel.initialize(supabaseUrl, anonKey);

            // Load persisted configuration (deviceId, session)
            let session = await this.loadPersistedConfig();

            // 2. Set Session or Authenticate
            if (session) {
                const { error } = await this.remoteChannel.setSession(session);

                if (error) {
                    console.log('   - ⚠️ Persisted session invalid:', error.message);
                    session = null;
                } else {
                    console.log('   - ✅ Session restored');
                }
            }

            if (!session) {
                console.log('\n🔐 Authenticating with Remote MCP server...');
                const authenticator = new DeviceAuthenticator(this.baseServerUrl);
                session = await authenticator.authenticate(this.deviceId);
                if (session.device_id) {
                    if (!this.deviceId) {
                        await captureRemote('remote_device_auth_success', {
                            "device": "assigned"
                        });
                        console.log(`   - ✅ Device ID assigned: ${session.device_id}`);
                    } else if (this.deviceId !== session.device_id) {
                        await captureRemote('remote_device_auth_success', {
                            "device": "changed"
                        });
                        console.log(`   - ⚠️ Device ID changed: ${this.deviceId} → ${session.device_id}`);
                    } else {
                        await captureRemote('remote_device_auth_success', {
                            "device": "authenticated"
                        });
                        console.log(`   - ✅ Device ID authenticated: ${session.device_id}`);
                    }
                    this.deviceId = session.device_id;
                }
                // Set session in Remote Channel
                const { error } = await this.remoteChannel.setSession(session);
                if (error) throw error;
            }


            this.authSubscription = this.remoteChannel.onAuthStateChange((event, refreshedSession) => {
                if (event !== 'TOKEN_REFRESHED' || !refreshedSession || !this.persistSession) return;
                this.queuePersistedConfigSave('token-refreshed');
            }).data.subscription;

            // Force save the current session immediately to ensure it's persisted
            await this.savePersistedConfig('startup');

            const deviceName = os.hostname();

            // Register as device
            await this.remoteChannel.registerDevice(
                await this.desktop.listClientTools(),
                this.deviceId,
                deviceName,
                (payload: any) => {
                    void this.handleNewToolCall(payload).catch((error: any) => {
                        console.error('Unhandled remote tool callback error:', error?.message || error);
                    });
                }
            );

            console.log('✅ Device ready:');
            console.log(`   - User:         ${this.remoteChannel.user!.email}`);
            console.log(`   - Device ID:    ${this.deviceId}`);
            console.log(`   - Device Name:  ${deviceName}`);

            // Keep process alive
            this.remoteChannel.startHeartbeat(this.deviceId!);

        } catch (error: any) {
            console.error(' - ❌ Device startup failed:', error.message);
            if (error.stack && process.env.DEBUG_MODE === 'true') {
                console.error('Stack trace:', error.stack);
            }
            await captureRemote('remote_device_startup_failed', { error });
            await this.shutdown();
            process.exit(1);
        }
    }


    async loadPersistedConfig() {
        try {
            console.debug('[DEBUG] Loading persisted config from:', this.configPath);
            const data = await fs.readFile(this.configPath, 'utf8');
            const config = JSON.parse(data);

            this.deviceId = config?.deviceId;
            console.debug('[DEBUG] Loaded device ID:', this.deviceId);

            console.log('💾 Found persisted session for device ' + this.deviceId);
            if (config.session) {
                console.debug('[DEBUG] Session found in config, returning session');
                return config.session;
            }

            console.debug('[DEBUG] No session in config');
            return null;
        } catch (error: any) {

            if (error.code !== 'ENOENT') {
                console.warn('⚠️ Failed to load config:', error.message);
                await captureRemote('remote_device_config_load_error', { error });
            } else {
                console.debug('[DEBUG] Config file does not exist (ENOENT)');
            }
            return null;
        } finally {
            // No need to ensure device ID here
        }
    }

    private queuePersistedConfigSave(reason: string): void {
        this.sessionSaveQueue = this.sessionSaveQueue
            .then(() => this.savePersistedConfig(reason))
            .catch((error: any) => {
                console.error(' - ❌ Failed queued session save:', error?.message || error);
            });
    }

    async savePersistedConfig(reason = 'manual') {
        try {
            console.debug('[DEBUG] Saving persisted config, persistSession:', this.persistSession, 'reason:', reason);
            const currentSessionStore = await this.remoteChannel.getSession();
            const session = currentSessionStore.data.session;

            const config = {
                deviceId: this.deviceId,
                session: (session && this.persistSession) ? {
                    access_token: session.access_token,
                    refresh_token: session.refresh_token
                } : null
            };
            const directory = path.dirname(this.configPath);
            const temporaryPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
            await fs.mkdir(directory, { recursive: true });
            await fs.writeFile(temporaryPath, JSON.stringify(config, null, 2), { mode: 0o600 });
            await fs.rename(temporaryPath, this.configPath);
            await fs.chmod(this.configPath, 0o600);
            console.debug('[DEBUG] Config atomically saved to:', this.configPath);
        } catch (error: any) {
            console.error(' - ❌ Failed to save config:', error.message);
            console.debug('[DEBUG] Config save error details:', error);
            await captureRemote('remote_device_config_save_error', { error });
        }
    }

    async fetchSupabaseConfig() {
        // No auth header needed for this public endpoint
        console.debug('[DEBUG] Fetching Supabase config from:', `${this.baseServerUrl}/api/mcp-info`);
        const response = await fetch(`${this.baseServerUrl}/api/mcp-info`);

        if (!response.ok) {
            console.debug('[DEBUG] Supabase config fetch failed, status:', response.status, response.statusText);
            throw new Error(`Failed to fetch Supabase config: ${response.statusText}`);
        }

        const config = await response.json();
        console.debug('[DEBUG] Supabase config received, URL:', config.supabaseUrl?.substring(0, 30) + '...');
        return {
            supabaseUrl: config.supabaseUrl,
            anonKey: config.supabasePublishableKey
        };
    }

    // Methods moved to RemoteChannel

    async handleNewToolCall(payload: any) {
        const toolCall = payload?.new;
        if (!toolCall || typeof toolCall.id !== 'string' || typeof toolCall.tool_name !== 'string') {
            console.warn('Ignoring malformed remote tool call payload');
            return;
        }

        const {
            id: call_id,
            tool_name,
            tool_args = {},
            device_id,
            metadata = {},
        } = toolCall;

        console.debug('[DEBUG] Tool call received, device_id:', device_id, 'this.deviceId:', this.deviceId);
        if (device_id && device_id !== this.deviceId) {
            console.debug('[DEBUG] Ignoring tool call for different device');
            return;
        }
        if (!this.callDeduplicator.begin(call_id)) {
            console.warn(`Ignoring duplicate remote tool call ${call_id}`);
            return;
        }

        console.log(
            `🔧 Received tool call ${call_id}: ${tool_name} ` +
            `${compactForLog(tool_args)} metadata: ${compactForLog(metadata, 512)}`
        );

        try {
            await this.remoteChannel.markCallExecuting(call_id);
            let result;

            if (tool_name === 'ping') {
                result = {
                    content: [{ type: 'text', text: `pong ${new Date().toISOString()}` }]
                };
            } else if (tool_name === 'shutdown') {
                result = {
                    content: [{ type: 'text', text: `Shutdown initialized at ${new Date().toISOString()}` }]
                };
                setTimeout(() => {
                    void (async () => {
                        console.log('🛑 Remote shutdown requested. Exiting...');
                        await this.shutdown();
                        process.exit(0);
                    })().catch((error: any) => {
                        console.error('Remote shutdown failed:', error?.message || error);
                    });
                }, 1000);
            } else {
                result = await this.desktop.callClientTool(tool_name, tool_args, metadata);
            }

            console.log(`✅ Tool call ${tool_name} completed: ${compactForLog(result)}`);
            await this.remoteChannel.updateCallResult(call_id, 'completed', result);

        } catch (error: any) {
            console.error(`❌ Tool call ${tool_name} failed:`, error?.message || error);
            try {
                await captureRemote('remote_device_tool_call_failed', { error, tool_name });
            } catch (telemetryError: any) {
                console.debug('[DEBUG] Failure telemetry was not delivered:', telemetryError?.message || telemetryError);
            }
            try {
                await this.remoteChannel.updateCallResult(
                    call_id,
                    'failed',
                    null,
                    error?.message || String(error),
                );
            } catch (updateError: any) {
                console.error('Failed to persist remote call failure:', updateError?.message || updateError);
            }
        } finally {
            this.callDeduplicator.finish(call_id);
        }
    }

    async shutdown() {
        if (this.isShuttingDown) {
            console.debug('[DEBUG] Shutdown already in progress, returning');
            return;
        }

        this.isShuttingDown = true;
        console.log('\n🛑 Shutting down device...');
        console.debug('[DEBUG] Shutdown initiated for device:', this.deviceId);

        try {
            this.authSubscription?.unsubscribe();
            await this.sessionSaveQueue;

            // Stop heartbeat first to prevent new operations
            console.log('  → Stopping heartbeat...');
            console.debug('[DEBUG] Calling stopHeartbeat()');
            this.remoteChannel.stopHeartbeat();
            console.log('  ✓ Heartbeat stopped');

            // Unsubscribe from channel
            console.log('  → Unsubscribing from channel...');
            console.debug('[DEBUG] Calling channel.unsubscribe()');
            await this.remoteChannel.unsubscribe();

            // Mark device offline
            console.log('  → Marking device offline...');
            console.debug('[DEBUG] Calling setOffline() with deviceId:', this.deviceId);
            await this.remoteChannel.setOffline(this.deviceId);

            // Shutdown desktop integration
            console.log('  → Shutting down desktop integration...');
            console.debug('[DEBUG] Calling desktop.shutdown()');
            await this.desktop.shutdown();
            console.log('  ✓ Desktop integration shut down');

            console.log('✓ Device shutdown complete');
            console.debug('[DEBUG] Shutdown sequence completed successfully');
        } catch (error: any) {
            console.error('Shutdown error:', error.message);
            console.debug('[DEBUG] Shutdown error stack:', error.stack);
            await captureRemote('remote_device_shutdown_error', { error });
        }
    }
}

// Start device if called directly or as a bin command
// When installed globally, npm creates a wrapper, so we need to check multiple conditions
const isMainModule = process.argv[1] && (
    // Direct execution: node device.js
    import.meta.url === `file://${process.argv[1]}` ||
    fileURLToPath(import.meta.url) === process.argv[1] ||
    // Global bin execution: desktop-commander-device (npm creates a wrapper)
    process.argv[1].endsWith('desktop-commander-device') ||
    process.argv[1].endsWith('desktop-commander-device.js')
);

if (isMainModule) {
    // Parse command-line arguments
    const args = process.argv.slice(2);
    const options = {
        persistSession: args.includes('--persist-session')
    };

    if (options.persistSession) {
        console.log('🔒 Session persistence enabled');
    }

    const device = new MCPDevice(options);
    device.start();
}
