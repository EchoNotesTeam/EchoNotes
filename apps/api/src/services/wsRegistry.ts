import { WebSocket } from "ws";

type ConnectionHandler = (jobId: string) => void;

export class WsRegistry {
  private subscriptions = new Map<string, Set<WebSocket>>();
  private onFirstSubscribe: ConnectionHandler;
  private onLastUnsubscribe: ConnectionHandler;

  constructor(onFirstSubscribe: ConnectionHandler, onLastUnsubscribe: ConnectionHandler) {
    this.onFirstSubscribe = onFirstSubscribe;
    this.onLastUnsubscribe = onLastUnsubscribe;
  }

  public subscribe(jobId: string, ws: WebSocket) {
    let clients = this.subscriptions.get(jobId);
    if (!clients) {
      clients = new Set();
      this.subscriptions.set(jobId, clients);
    }
    clients.add(ws);
    if (clients.size === 1) {
      this.onFirstSubscribe(jobId);
    }
  }

  public unsubscribe(jobId: string, ws: WebSocket) {
    const clients = this.subscriptions.get(jobId);
    if (!clients) return;
    clients.delete(ws);
    if (clients.size === 0) {
      this.subscriptions.delete(jobId);
      this.onLastUnsubscribe(jobId);
    }
  }

  public unsubscribeAll(ws: WebSocket) {
    for (const [jobId, clients] of this.subscriptions.entries()) {
      if (clients.has(ws)) {
        this.unsubscribe(jobId, ws);
      }
    }
  }

  public broadcast(jobId: string, data: any) {
    const clients = this.subscriptions.get(jobId);
    if (!clients) return;
    const message = JSON.stringify(data);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }
}
