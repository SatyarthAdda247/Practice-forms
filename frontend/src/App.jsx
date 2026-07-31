import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.jsx";
import Layout from "./components/Layout.jsx";
import Loading from "./components/Loading.jsx";
import Login from "./pages/Login.jsx";
import ExamsList from "./pages/ExamsList.jsx";
import AnswerKeyConfig from "./pages/AnswerKeyConfig.jsx";
import BulkUpload from "./pages/BulkUpload.jsx";
import Results from "./pages/Results.jsx";
import Admin from "./pages/Admin.jsx";
import Usage from "./pages/Usage.jsx";
import Leads from "./pages/Leads.jsx";
import ImageResizer from "./pages/ImageResizer.jsx";
import AnswerKeyChecker from "./pages/AnswerKeyChecker.jsx";
import GovtExamForm from "./pages/GovtExamForm.jsx";
import ExamFormsLanding from "./pages/ExamFormsLanding.jsx";

// Auth gate: redirects to /login when there is no signed-in user.
function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <Loading className="min-h-screen" />;
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
function RequireAdmin({ children }) {
  const { user } = useAuth();
  if (!["admin", "super_admin"].includes(user?.role)) return <Navigate to="/exams" replace />;
  return children;
}

// Stricter gate for pages a regular admin must not see (usage analytics).
// The API enforces this too — this only keeps the route from rendering.
// Leads hold candidate personal data: super admins always, others only once a
// super admin approves them (canViewLeads comes from /api/auth/me).
function RequireLeadAccess({ children }) {
  const { user } = useAuth();
  if (!(user?.role === "super_admin" || user?.canViewLeads)) {
    return <Navigate to="/exams" replace />;
  }
  return children;
}

function RequireSuperAdmin({ children }) {
  const { user } = useAuth();
  if (user?.role !== "super_admin") return <Navigate to="/exams" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Public standalone tools for the main adda247.com site. Deliberately
            outside RequireAuth and Layout: no sign-in, no portal chrome, and
            the portal's own navigation never links to them. */}
        <Route path="/image-resizer" element={<ImageResizer />} />
        <Route path="/answerkey-checker" element={<AnswerKeyChecker />} />
        <Route path="/exam-forms" element={<ExamFormsLanding />} />
        <Route path="/exam-forms/" element={<ExamFormsLanding />} />
        <Route path="/Exam-forms" element={<ExamFormsLanding />} />
        <Route path="/Exam-forms/" element={<ExamFormsLanding />} />
        <Route path="/exam-forms/IBPS-PO" element={<GovtExamForm />} />
        <Route path="/Exam-forms/IBPS-PO" element={<GovtExamForm />} />
        <Route path="/" element={<Navigate to="/exam-forms/" replace />} />
        <Route element={<RequireAuth />}>
          <Route path="/exams" element={<ExamsList />} />
          <Route path="/exams/new" element={<AnswerKeyConfig />} />
          <Route path="/exams/:id" element={<AnswerKeyConfig />} />
          <Route path="/upload" element={<BulkUpload />} />
          <Route path="/upload/:id" element={<BulkUpload />} />
          <Route path="/results" element={<Results />} />
          <Route path="/results/:id" element={<Results />} />
          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
          <Route path="/admin/usage" element={<RequireSuperAdmin><Usage /></RequireSuperAdmin>} />
          <Route path="/leads" element={<RequireLeadAccess><Leads /></RequireLeadAccess>} />
        </Route>
        <Route path="*" element={<Navigate to="/exam-forms/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

