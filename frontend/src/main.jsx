import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { UiLangProvider } from './context/UiLangContext';
import AdminPage from './AdminPage';
import { HomePage } from './pages/HomePage';
import { BookingPage } from './pages/BookingPage';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ForgotPassword } from './pages/ForgotPassword';
import { Profile } from './pages/Profile';
import { OrderList } from './pages/OrderList';
import { OrderDetail } from './pages/OrderDetail';
import { OrderAiRecord } from './pages/OrderAiRecord';
import { OrderVoucher } from './pages/OrderVoucher';
import './index.css';

const API = import.meta.env.VITE_API_BASE || '/api';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <UiLangProvider>
        <AuthProvider apiBase={API}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/book" element={<BookingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/orders" element={<OrderList />} />
            <Route path="/orders/:orderNo" element={<OrderDetail />} />
            <Route path="/orders/:orderNo/ai-record" element={<OrderAiRecord />} />
            <Route path="/orders/:orderNo/voucher" element={<OrderVoucher />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </AuthProvider>
      </UiLangProvider>
    </BrowserRouter>
  </React.StrictMode>
);
