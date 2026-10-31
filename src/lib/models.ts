export type LinkStatus = 'PENDING' | 'ACTIVATED' | 'EXPIRED' | 'REVOKED';
export type Channel = 'SMS' | 'WHATSAPP';
export interface ChatLink {
  id: string;
  tokenHash: string;
  customerId: string;
  customerName: string;
  channel: Channel;
  status: LinkStatus;
  createdAt: number;
  expiresAt: number;
  openedAt?: number;
  activatedAt?: number;
  sessionHash?: string;
  blockedAttempts: number;
  messageCount: number;
}
export interface Session {
  id: string;
  linkHash: string;
  customerId: string;
  bindingId: string;
  createdAt: number;
  absoluteExpiresAt: number;
  idleExpiresAt: number;
  revoked: boolean;
  started: boolean;
}
export interface Binding {
  id: string;
  publicKey: JsonWebKey;
}
export interface Challenge {
  nonce: string;
  kind: 'activation' | 'session';
  subject: string;
  bindingId: string;
  expiresAt: number;
  payload: string;
}
export interface Message {
  id: string;
  role: 'customer' | 'application';
  text: string;
  createdAt: number;
}
export type EventType =
  | 'LINK_CREATED'
  | 'LINK_OPENED'
  | 'LINK_ACTIVATED'
  | 'LINK_EXPIRED'
  | 'LINK_ALREADY_USED'
  | 'LINK_REVOKED'
  | 'ACTIVATION_FAILED'
  | 'SESSION_CREATED'
  | 'SESSION_RESUMED'
  | 'SESSION_EXPIRED'
  | 'DEVICE_PROOF_FAILED'
  | 'CHAT_STARTED'
  | 'MESSAGE_SENT'
  | 'UNAUTHORIZED_ACCESS_BLOCKED';
export interface SecurityEvent {
  type: EventType;
  at: number;
  linkId?: string;
}
export interface Dashboard {
  totals: Record<string, number>;
  distribution: Record<LinkStatus, number>;
  activeSessions: number;
  daily: { date: string; counts: Record<string, number> }[];
  events: SecurityEvent[];
}
