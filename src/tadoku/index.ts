import ReconnectingWebSocket from "reconnecting-websocket";

export class Tadoku {
  private socket: ReconnectingWebSocket;
  private URL = "ws://localhost:6969";

  constructor() {
    this.socket = new ReconnectingWebSocket(this.URL);
  }

  get isConnected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  onStatusChange(callback: (connected: boolean) => void) {
    // Fire immediately with current state
    callback(this.isConnected);
    this.socket.addEventListener("open", () => callback(true));
    this.socket.addEventListener("close", () => callback(false));
    this.socket.addEventListener("error", () => callback(false));
  }

  send(time: number, processPath: string, charsRead?: number) {
    const payload: Record<string, unknown> = { time, process_path: processPath };
    if (charsRead !== undefined) {
      payload.chars_read = charsRead;
    }
    this.socket.send(JSON.stringify(payload));
  }
}
