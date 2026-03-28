import WebSocket from 'ws';
import { createEnvelope } from '@agent-protocol/protocol';

export class ConnectionManager {
  constructor({ relayUrl, agentCard, adminKey, onMessage, onDisconnect }) {
    this.relayUrl = relayUrl;
    this.agentCard = agentCard;
    this.adminKey = adminKey;
    this.sessionSecret = null; // set after registration
    this.onMessage = onMessage || (() => {});
    this.onDisconnect = onDisconnect || (() => {});
    this.ws = null;
    this.pendingRequests = new Map();
    this.messageQueue = [];
    this.maxQueueSize = 100;
    this._reconnecting = false;
    this._shouldReconnect = false;

    if (relayUrl.startsWith('ws://') && !relayUrl.includes('127.0.0.1') && !relayUrl.includes('localhost') && !relayUrl.includes('::1')) {
      console.error('[agent-protocol] WARNING: Using unencrypted ws:// to a remote host. Use wss:// for production.');
    }
  }

  async connect() {
    return new Promise((resolve, reject) => {
      // Always authenticate with admin key
      this.ws = new WebSocket(this.relayUrl, { headers: { Authorization: `Bearer ${this.adminKey}` } });

      this.ws.on('open', async () => {
        try {
          const result = await this._register();
          if (result.sessionSecret) this.sessionSecret = result.sessionSecret;
          this._shouldReconnect = true;
          resolve(result);
        } catch (err) { reject(err); }
      });

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const { resolve, reject } = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
          return;
        }
        this.onMessage(msg);
      });

      this.ws.on('close', (code) => {
        this.sessionSecret = null; // session secret is invalidated on disconnect
        if (this._shouldReconnect && code !== 1000 && code !== 1008 && code !== 4001) this._reconnect();
        this.onDisconnect(code);
      });

      this.ws.on('error', (err) => { if (this.ws.readyState !== WebSocket.OPEN) reject(err); });
    });
  }

  async _register() {
    // Registration is signed with admin key
    return this.sendRequest('agents/register', undefined, { agentCard: this.agentCard });
  }

  async sendRequest(method, to, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.messageQueue.length >= this.maxQueueSize) this.messageQueue.pop();
      return new Promise((resolve, reject) => { this.messageQueue.push({ method, to, params, resolve, reject }); });
    }
    // Registration uses admin key, all other messages use session secret
    const secret = method === 'agents/register' ? this.adminKey : this.sessionSecret;
    const envelope = createEnvelope({ method, from: this.agentCard.name, to, params, secret });
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(envelope.id, { resolve, reject });
      this.ws.send(JSON.stringify(envelope));
      setTimeout(() => {
        if (this.pendingRequests.has(envelope.id)) {
          this.pendingRequests.delete(envelope.id);
          reject(new Error(`Request timed out: ${method}`));
        }
      }, 10000);
    });
  }

  async _reconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    let delay = 1000;
    while (this._shouldReconnect) {
      await new Promise((r) => setTimeout(r, delay));
      try { await this.connect(); this._reconnecting = false; await this._flushQueue(); return; }
      catch { delay = Math.min(delay * 2, 30000); }
    }
    this._reconnecting = false;
  }

  async _flushQueue() {
    const queue = [...this.messageQueue];
    this.messageQueue = [];
    for (const { method, to, params, resolve, reject } of queue) {
      try { resolve(await this.sendRequest(method, to, params)); } catch (err) { reject(err); }
    }
  }

  isConnected() { return this.ws?.readyState === WebSocket.OPEN; }

  async disconnect() {
    this._shouldReconnect = false;
    this.sessionSecret = null;
    if (this.ws) { this.ws.close(1000); this.ws = null; }
  }
}
