import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './stores/authStore.tsx';
import { ConfirmationProvider } from './components/Confirmation.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ConfirmationProvider><App /></ConfirmationProvider>
    </AuthProvider>
  </StrictMode>,
);
