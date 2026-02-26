import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import AdminPage from './AdminPage';
import { HomePage } from './pages/HomePage';
import { BookingPage } from './pages/BookingPage';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ForgotPassword } from './pages/ForgotPassword';
import { Profile } from './pages/Profile';
import { OrderList } from './pages/OrderList';
import { OrderDetail } from './pages/OrderDetail';
import './index.css';

const API = import.meta.env.VITE_API_BASE || '/api';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
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
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
