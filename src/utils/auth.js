// Authentication utilities
const TOKEN_KEY = 'auth_token';
const EXPIRY_KEY = 'auth_expiry';

export const authUtils = {
  // Store token and expiry in localStorage
  storeToken: (token) => {
    try {
      // Decode token to get expiry
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiry = payload.exp * 1000; // Convert to milliseconds
      
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(EXPIRY_KEY, expiry.toString());
      
      return true;
    } catch (error) {
      console.error('Error storing token:', error);
      return false;
    }
  },

  // Get token from localStorage
  getToken: () => {
    return localStorage.getItem(TOKEN_KEY);
  },

  // Get expiry from localStorage
  getExpiry: () => {
    const expiry = localStorage.getItem(EXPIRY_KEY);
    return expiry ? parseInt(expiry) : null;
  },

  // Check if token is expired
  isTokenExpired: () => {
    const expiry = authUtils.getExpiry();
    if (!expiry) return true;
    
    const currentTime = Date.now();
    return currentTime >= expiry;
  },

  // Check if user is authenticated (has valid token)
  isAuthenticated: () => {
    const token = authUtils.getToken();
    if (!token) return false;
    
    return !authUtils.isTokenExpired();
  },

  // Clear token and expiry from localStorage
  clearAuth: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
  },

  // Decode token payload
  decodeToken: (token) => {
    try {
      const payload = token.split('.')[1];
      return JSON.parse(atob(payload));
    } catch (error) {
      console.error('Error decoding token:', error);
      return null;
    }
  },

  // Initialize auth check on app start
  initializeAuth: () => {
    if (authUtils.isTokenExpired()) {
      authUtils.clearAuth();
    }
  }
};
