declare var AASocket: {
    prototype: Socket;
    new(url: string | URL, protocols?: string | string[]): Socket;
    readonly CONNECTING: 0;
    readonly OPEN: 1;
    readonly CLOSING: 2;
    readonly CLOSED: 3;
  };