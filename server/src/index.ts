import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

function log(message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}]`;
  
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function generateAccessKey(): string {
  const bytes = randomBytes(9); // 9 bytes = 72 bits of entropy
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  
  return Array.from({ length: 12 }, (_, i) => {
    const byteIndex = Math.floor(i * 0.75); // 12 chars from 9 bytes
    const charIndex = bytes[byteIndex] % chars.length;
    return chars[charIndex];
  })
  .map((char, i) => (i > 0 && i % 4 === 0) ? `-${char}` : char)
  .join('');
}

const ACCESS_KEY = process.env.ACCESS_KEY || generateAccessKey();
log(`Access key initialized: ${ACCESS_KEY}`);

type ClientInfo = {
  authenticated: boolean;
};

type VideoState = {
  currentTime: number;
  paused: boolean;
  playbackRate: number;
};

type Message = {
  type: string;
  accessKey?: string;
  action?: string;
  data?: VideoState;
};

// Room state
const clients = new Map<WebSocket, ClientInfo>();
let lastState: VideoState | null = null;

function broadcast(message: object, excludeClient: WebSocket | null = null): void {
  const data = JSON.stringify(message);
  let sentCount = 0;
  
  for (const [client, clientInfo] of clients) {
    if (client !== excludeClient && 
        client.readyState === WebSocket.OPEN && 
        clientInfo.authenticated) {
      try {
        client.send(data);
        sentCount++;
      } catch (error) {
        log('Failed to send message to client', error);
      }
    }
  }
  
  if (sentCount > 0) {
    log(`Broadcast sent to ${sentCount} client(s)`, { type: (message as any).type });
  }
}

function getAuthenticatedCount(): number {
  return Array.from(clients.values()).filter(c => c.authenticated).length;
}

function handleMessage(ws: WebSocket, message: Message): void {
  log(`Received message: ${message.type}`);
  
  const client = clients.get(ws);
  if (!client) return;
  
  switch (message.type) {
    case 'auth':
      handleAuth(ws, message);
      break;
    case 'sync':
      if (client.authenticated) {
        handleSync(ws, message);
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Unauthorized'
        }));
      }
      break;
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Unknown message type'
      }));
  }
}

function handleAuth(ws: WebSocket, message: Message): void {
  const { accessKey } = message;
  const client = clients.get(ws);
  
  if (!client) return;
  
  if (accessKey !== ACCESS_KEY) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Invalid access key'
    }));
    log('Authentication failed: invalid access key');
    return;
  }
  
  client.authenticated = true;
  
  const authenticatedCount = getAuthenticatedCount();
  
  ws.send(JSON.stringify({
    type: 'authenticated',
    participants: authenticatedCount
  }));
  
  broadcast({
    type: 'participant-update',
    participants: authenticatedCount
  }, ws);
  
  if (lastState) {
    ws.send(JSON.stringify({
      type: 'sync',
      action: 'state-update',
      data: lastState
    }));
  }
  
  log(`Client authenticated. Total participants: ${authenticatedCount}`);
}

function handleSync(ws: WebSocket, message: Message): void {
  if (message.action === 'state-update' && message.data) {
    lastState = message.data;
  }
  
  broadcast({
    type: 'sync',
    action: message.action,
    data: message.data
  }, ws);
  
  log(`Sync command: ${message.action}`, message.data ? { currentTime: message.data.currentTime, paused: message.data.paused } : undefined);
}

function handleConnection(ws: WebSocket): void {
  log('New WebSocket connection established');
  clients.set(ws, { authenticated: false });
  
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to sync server. Please authenticate.'
  }));
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as Message;
      handleMessage(ws, message);
    } catch (error) {
      log('Error parsing message', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });
  
  ws.on('close', () => {
    log('WebSocket connection closed');
    
    if (clients.has(ws)) {
      clients.delete(ws);
      
      const authenticatedCount = getAuthenticatedCount();
      
      broadcast({
        type: 'participant-update',
        participants: authenticatedCount
      });
      
      log(`Participant left. Remaining participants: ${authenticatedCount}`);
    }
  });
  
  ws.on('error', (error) => {
    log('WebSocket error', error);
  });
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  log(`HTTP ${req.method} ${req.url}`);
  
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', handleConnection);

wss.on('error', (error) => {
  log('WebSocket Server error', error);
});

server.listen(PORT, () => {
  log(`Server started on port ${PORT}`);
  console.log('');
  console.log('========================================');
  console.log('🎬 Sync Watch Server Started');
  console.log('========================================');
  console.log(`HTTP:       http://localhost:${PORT}`);
  console.log(`WebSocket:  ws://localhost:${PORT}`);
  console.log('');
  console.log(`Access Key: ${ACCESS_KEY}`);
  console.log('');
  console.log('Share this access key with participants');
  console.log('');
  console.log('To expose via ngrok:');
  console.log(`  ngrok http ${PORT}`);
  console.log('========================================');
  console.log('');
});

process.on('uncaughtException', (error) => {
  log('Uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('Unhandled rejection', { reason, promise });
});

process.on('SIGINT', () => {
  log('Server shutting down (SIGINT)');
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  log('Server shutting down (SIGTERM)');
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
});