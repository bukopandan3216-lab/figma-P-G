import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { CatalogProvider } from './context/CatalogContext';
import { RequireAuth, RequirePermission } from './components/ProtectedRoute';

// Customer pages
import HomePage from './pages/customer/HomePage';
import CategoryPage from './pages/customer/CategoryPage';
import ProductDetailPage from './pages/customer/ProductDetailPage';
import SearchPage from './pages/customer/SearchPage';
import CartCheckoutPage from './pages/customer/CartCheckoutPage';
import QuizPage from './pages/customer/QuizPage';
import ForYouPage from './pages/customer/ForYouPage';
import InfoPage from './pages/customer/InfoPage';
import { LoginPage, RegisterPage, ForgotPasswordPage, AccountPage } from './pages/customer/AccountPages';
import FloatingChat from './components/FloatingChat';
import { ChatProvider } from './context/ChatContext';
import CustomerNav from './components/CustomerNav';
import CustomerFooter from './components/CustomerFooter';
import { Button } from './components/ui';

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminProducts from './pages/admin/AdminProducts';
import AdminInventory from './pages/admin/AdminInventory';
import AdminInsights from './pages/admin/AdminInsights';
import {
  AdminSuppliers, AdminPurchases, AdminCustomers, AdminSales,
  AdminRecommendations, AdminReports, AdminUsers, AdminSettings, AdminLogin,
  ContactUsReportPage
} from './pages/admin/AdminPages';
import AdminActivityLog from './pages/admin/AdminActivityLog';


function CustomerChatStack() {
  return (
    <div className="fixed bottom-6 right-6 z-100 flex flex-col items-end gap-3">
      <FloatingChat variant="ai" title="Beauty Stylist" subtitle="Beauty recommendations" />
      <FloatingChat variant="support" title="Support Desk" subtitle="Help and customer care" />
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <CustomerNav />
      <main className="mx-auto flex min-h-[55vh] max-w-3xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
        <p className="font-mono text-sm font-semibold text-[var(--primary)]">404</p>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">This page isn’t here</h1>
        <p className="mt-3 max-w-md text-sm text-[var(--muted-foreground)]">The link may be outdated, or the page may have moved.</p>
        <Link to="/" className="mt-6"><Button>Back to Home</Button></Link>
      </main>
      <CustomerFooter />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <CatalogProvider>
          <BrowserRouter>
          <ChatProvider>
          <Routes>
            {/* Public customer routes */}
            <Route path="/" element={<><HomePage /></>} />
            <Route path="/info/:slug" element={<InfoPage />} />
            <Route path="/category/:id" element={<><CategoryPage /><CustomerChatStack /></>} />
            <Route path="/product/:id" element={<><ProductDetailPage /><CustomerChatStack /></>} />
            <Route path="/search" element={<><SearchPage /></>} />
            <Route path="/cart" element={<RequireAuth><><CartCheckoutPage /><CustomerChatStack /></></RequireAuth>} />
            <Route path="/quiz" element={<RequireAuth><><QuizPage /><CustomerChatStack /></></RequireAuth>} />
            <Route path="/for-you" element={<RequireAuth><><ForYouPage /><CustomerChatStack /></></RequireAuth>} />
            <Route path="/login" element={<><LoginPage /><CustomerChatStack /></>} />
            <Route path="/register" element={<><RegisterPage /><CustomerChatStack /></>} />
            <Route path="/forgot-password" element={<><ForgotPasswordPage /><CustomerChatStack /></>} />

            {/* Protected customer routes */}
            <Route path="/account" element={<RequireAuth><><AccountPage /><CustomerChatStack /></></RequireAuth>} />
            <Route path="/wishlist" element={<RequireAuth><><AccountPage initialSection="wishlist" /><CustomerChatStack /></></RequireAuth>} />
            <Route path="/orders" element={<RequireAuth><><AccountPage initialSection="orders" /><CustomerChatStack /></></RequireAuth>} />

            {/* Admin routes */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin/dashboard" element={<RequirePermission module="dashboard"><AdminDashboard /></RequirePermission>} />
            <Route path="/admin/products" element={<RequirePermission module="products"><AdminProducts /></RequirePermission>} />
            <Route path="/admin/inventory" element={<RequirePermission module="inventory"><AdminInventory /></RequirePermission>} />
            <Route path="/admin/suppliers" element={<RequirePermission module="suppliers"><AdminSuppliers /></RequirePermission>} />
            <Route path="/admin/purchases" element={<RequirePermission module="purchases"><AdminPurchases /></RequirePermission>} />
            <Route path="/admin/customers" element={<RequirePermission module="customers"><AdminCustomers /></RequirePermission>} />
            <Route path="/admin/sales" element={<RequirePermission module="sales"><AdminSales /></RequirePermission>} />
            <Route path="/admin/insights" element={<RequirePermission module="insights"><AdminInsights /></RequirePermission>} />
            <Route path="/admin/recommendations" element={<RequirePermission module="recommendations"><AdminRecommendations /></RequirePermission>} />
            <Route path="/admin/reports" element={<RequirePermission module="reports"><AdminReports /></RequirePermission>} />
            <Route path="/admin/reports/contact-us" element={<RequirePermission module="support"><ContactUsReportPage /></RequirePermission>} />
            <Route path="/admin/users" element={<RequirePermission module="users"><AdminUsers /></RequirePermission>} />
            <Route path="/admin/activity" element={<RequirePermission module="activity"><AdminActivityLog /></RequirePermission>} />
            <Route path="/admin/settings" element={<RequirePermission module="settings"><AdminSettings /></RequirePermission>} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          </ChatProvider>
          </BrowserRouter>
        </CatalogProvider>
      </AppProvider>
    </AuthProvider>
  );
}
