'use client';

import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './api';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001';

let socket: Socket | null = null;

/** Singleton socket: (re)connects with the current access token. */
export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(SOCKET_URL, {
    transports: ['websocket'],
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  // Heartbeat keeps the presence TTL alive.
  const beat = setInterval(() => {
    if (socket?.connected) socket.emit('presence:heartbeat');
  }, 30000);
  socket.on('disconnect', () => undefined);
  socket.io.on('close', () => clearInterval(beat));

  if (typeof window !== 'undefined') {
    window.addEventListener('bs:tokens-changed', () => {
      // Force a reconnect so the handshake picks up the fresh token.
      if (socket) {
        socket.disconnect();
        if (getAccessToken()) socket.connect();
      }
    });
  }
  return socket;
}

export function destroySocket() {
  socket?.disconnect();
  socket = null;
}
