import axios from 'axios';
import { apiRequest } from '../api/session';
// Legacy callers share authenticated transport; a selected store is not an authorization boundary.
const request = axios.create({ baseURL: '/api/v1' });
request.defaults.adapter = async config => {
  const query = new URLSearchParams(config.params).toString();
  const headers = new Headers();
  Object.entries(config.headers.toJSON()).forEach(([key, value]) => { if (value != null) headers.set(key, String(value)); });
  const data = await apiRequest(String(config.url) + (query ? '?' + query : ''), { method: config.method?.toUpperCase(), headers, body: config.data, signal: config.signal as AbortSignal });
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};
export default request;