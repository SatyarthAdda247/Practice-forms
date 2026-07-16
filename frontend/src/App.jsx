import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.jsx";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import ExamsList from "./pages/ExamsList.jsx";
import AnswerKeyConfig from "./pages/AnswerKeyConfig.jsx";
import BulkUpload from "./pages/BulkUpload.jsx";
import Results from "./pages/Results.jsx";
import Admin from "./pages/Admin.jsx";

// Gate: while the persisted session is validated, show nothing; then either
// render the app shell (authed) or bounce to /login remembering where we were.
function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-secondary font-body-md">
        Loading…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

// Admin-only gate (used inside the authed layout). Non-admins are redirected.
function RequireAdmin() {
  const { user } = useAuth();
  if (!["admin", "super_admin"].includes(user?.role)) return <Navigate to="/exams" replace />;
  return <Admin />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Navigate to="/exams" replace />} />
          <Route path="/exams" element={<ExamsList />} />
          <Route path="/exams/new" element={<AnswerKeyConfig />} />
          <Route path="/exams/:id" element={<AnswerKeyConfig />} />
          <Route path="/upload" element={<BulkUpload />} />
          <Route path="/upload/:id" element={<BulkUpload />} />
          <Route path="/results" element={<Results />} />
          <Route path="/results/:id" element={<Results />} />
          <Route path="/admin" element={<RequireAdmin />} />
          <Route path="*" element={<Navigate to="/exams" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
