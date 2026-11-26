/**
 * Single source of truth for Offline Pay configuration.
 *
 * SERVER_PUBLIC_KEY_B64 is baked at build time (never fetched at runtime,
 * because HTTPS pages cannot fetch HTTP backends due to mixed content).
 * Run `scripts/export-public-key.ps1` to refresh from the backend or keys/.
 */
export const SERVER_PUBLIC_KEY_B64 =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3izJsIWU5kRQB/Q4yF2Xfp1dQvJgBjKxngreXSCXgNYRs2GKDliuvSDp6AqBH+zcoJ5uzfLXPZxFhhkBkx/ocCv+auThwJZMB0ixMoqe8S5flm6b+Y6te2yxHzODg2zpPh+i47S9pN5UYTF29+382EwI5wQbo5Y737wBzbR4e9NHliS/wQ6nRXHAAOyEr3uRSPiYEKVuzwZHZoggTbSRrc6MS1CZO0W0y02lPU10jApFkLHb2y1Rc949MRs4IU1rMjk862y2eqSvBfq6tmhss37b2PHhhLyaEQyzeW8u3Iw3oaEjlXzenNwY8ksx+z/CUY8X+Dpq8faLLYuPijXbtwIDAQAB';

export const SERVICE_UUID = '7e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const PACKET_CHAR_UUID = '7e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const STATUS_CHAR_UUID = '7e400003-b5a3-f393-e0a9-e50e24dcca9e';

export const CHUNK_PAYLOAD_SIZE = 140;
export const OFFLINE_LIMIT_INR = 500;

/**
 * Backend API base URL. Empty string = same origin (when served by Spring Boot).
 */
export const API_BASE = '';
