import axios from 'axios';
import { shopStore } from '../stores/shop';
import { userStore } from '../stores/user';
import { Role } from './roleEnum';

// Create an Axios instance
const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

// Configure the Request Interceptor to lock currentStoreId for STORE_MANAGER
request.interceptors.request.use(
  (config) => {
    // Check if the current role is STORE_MANAGER
    if (userStore.currentRole === Role.STORE_MANAGER) {
      const currentStoreId = shopStore.currentStoreId;
      if (currentStoreId !== undefined && currentStoreId !== null) {
        // 1. Force inject into Headers
        if (config.headers) {
          if (typeof config.headers.set === 'function') {
            config.headers.set('X-Store-Id', String(currentStoreId));
            config.headers.set('currentStoreId', String(currentStoreId));
          } else {
            (config.headers as any)['X-Store-Id'] = String(currentStoreId);
            (config.headers as any)['currentStoreId'] = String(currentStoreId);
          }
        }

        // 2. Force inject into URL Params
        config.params = config.params || {};
        config.params['currentStoreId'] = currentStoreId;

        // 3. Force inject into Request payload (for POST, PUT etc.) if it represents a JSON payload
        if (
          config.data && 
          typeof config.data === 'object' && 
          !(config.data instanceof FormData)
        ) {
          try {
            config.data['currentStoreId'] = currentStoreId;
          } catch (e) {
            // Handle read-only data objects gracefully
            config.data = { ...config.data, currentStoreId };
          }
        }
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default request;
