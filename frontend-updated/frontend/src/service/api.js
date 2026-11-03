// 127.0.0.1, not "localhost": on Windows "localhost" tries IPv6 (::1) first and the backend only listens on IPv4,
// which adds ~200 ms to EVERY request (measured 225 ms vs 14 ms) and made the whole UI laggy.
export const API = "http://127.0.0.1:8000";