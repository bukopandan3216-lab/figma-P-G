import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { CatalogProvider } from './context/CatalogContext';
import { RequireAuth, RequireAdmin } from './components/ProtectedRoute';

// Customer pages
import HomePage from './pages/customer/HomePage';
import CategoryPage from './pages/customer/CategoryPage';
import ProductDetailPage from './pages/customer/ProductDetailPage';
import SearchPage from './pages/customer/SearchPage';
import CartCheckoutPage from './pages/customer/CartCheckoutPage';
import QuizPage from './pages/customer/QuizPage';
import ForYouPage from './pages/customer/ForYouPage';
import { LoginPage, RegisterPage, ForgotPasswordPage, AccountPage, WishlistPage, OrdersPage } from './pages/customer/AccountPages';
import FloatingChat from './components/FloatingChat';

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminProducts from './pages/admin/AdminProducts';
import AdminInventory from './pages/admin/AdminInventory';
import {
  AdminSuppliers, AdminPurchases, AdminCustomers, AdminSales,
  AdminInsights, AdminRecommendations, AdminReports, AdminUsers, AdminSettings, AdminLogin,
  ContactUsReportPage
} from './pages/admin/AdminPages';

function CustomerChatStack() {
  return (
    <div className="fixed bottom-6 right-6 z-100 flex flex-col items-end gap-3">
      <FloatingChat variant="ai" title="AI Stylist" subtitle="Beauty recommendations" />
      <FloatingChat variant="support" title="Support Desk" subtitle="Help and customer care" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <CatalogProvider>
          <BrowserRouter>
          <Routes>
            {/* Public customer routes */}
            <Route path="/" element={<><HomePage /><CustomerChatStack /></>} />
            <Route path="/category/:id" element={<><CategoryPage /><CustomerChatStack /></>} />
            <Route path="/product/:id" element={<><ProductDetailPage /><CustomerChatStack /></>} />
            <Route path="/search" element={<><SearchPage /><CustomerChatStack /></>} />
            <Route path="/cart" element={<RequireAuth><><CartCheckoutPage /><CustomerChatStack /></></RequireAuth>} />
            <Route path="/quiz" element={<><QuizPage /><CustomerChatStack /></>} />
            <Route path="/for-you" element={<><ForYouPage /><CustomerChatStack /></>} />
            <Route path="/admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
            <Route path="/login" element={<><LoginPage /><CustomerChatStack /></>} />
            <Route path="/register" element={<><RegisterPage /><CustomerChatStack /></>} />
            <Route path="/forgot-password" element={<><ForgotPasswordPage /><CustomerChatStack /></>} />

            {/* Protected customer routes */}
            <Route path="/account" element={<RequireAuth><><AccountPage /><CustomerChatStack /></></RequireAuth>} />
            <Route path="/wishlist" element={<RequireAuth><><WishlistPage /><CustomerChatStack /></></RequireAuth>} />
            <Route path="/orders" element={<RequireAuth><><OrdersPage /><CustomerChatStack /></></RequireAuth>} />

            {/* Admin routes */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin/dashboard" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
            <Route path="/admin/products" element={<RequireAdmin><AdminProducts /></RequireAdmin>} />
            <Route path="/admin/inventory" element={<RequireAdmin><AdminInventory /></RequireAdmin>} />
            <Route path="/admin/suppliers" element={<RequireAdmin><AdminSuppliers /></RequireAdmin>} />
            <Route path="/admin/purchases" element={<RequireAdmin><AdminPurchases /></RequireAdmin>} />
            <Route path="/admin/customers" element={<RequireAdmin><AdminCustomers /></RequireAdmin>} />
            <Route path="/admin/sales" element={<RequireAdmin><AdminSales /></RequireAdmin>} />
            <Route path="/admin/insights" element={<RequireAdmin><AdminInsights /></RequireAdmin>} />
            <Route path="/admin/recommendations" element={<RequireAdmin><AdminRecommendations /></RequireAdmin>} />
            <Route path="/admin/reports" element={<RequireAdmin><AdminReports /></RequireAdmin>} />
            <Route path="/admin/reports/contact-us" element={<RequireAdmin><ContactUsReportPage /></RequireAdmin>} />
            <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
            <Route path="/admin/settings" element={<RequireAdmin><AdminSettings /></RequireAdmin>} />
          </Routes>
          </BrowserRouter>
        </CatalogProvider>
      </AppProvider>
    </AuthProvider>
  );
}
