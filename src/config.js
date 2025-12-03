// Use relative URLs in production, absolute in development
export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3001/api');
export const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:3000');
