import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import TestAsUser from "./TestAsUser.jsx";
import { useAuth } from "../auth.jsx";

const SUPPORT_EMAIL = "umesh.rao@adda247.com";

const BASE_NAV = [
  { to: "/exams", label: "Exams", icon: "assignment" },
  { to: "/upload", label: "Uploads", icon: "cloud_upload" },
  { to: "/results", label: "Results", icon: "analytics" },
];
// `end` on Administrator so it does not also light up on /admin/usage.
const ADMIN_NAV = { to: "/admin", label: "Administrator", icon: "admin_panel_settings", end: true };
// Usage analytics is super-admin only, matching GET /api/admin/usage.
const SUPER_ADMIN_NAV = { to: "/admin/usage", label: "Daily Usage", icon: "monitoring" };
// Shown only to users a super admin has approved for candidate leads.
const LEADS_NAV = { to: "/leads", label: "Resizer Leads", icon: "contacts" };
// Marking schemes for the public Answer Key Checker. Same rule as leads: super
// admins always, others only once a super admin approves them.
const MARKING_NAV = { to: "/admin/marking", label: "Exam Marking", icon: "rule" };

function Item({ to, label, icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-md px-md py-sm rounded-xl font-label-md text-label-md transition-all duration-200 ease-in-out ${
          isActive
            ? "bg-secondary-container text-on-secondary-container"
            : "text-on-surface-variant hover:bg-surface-container-high"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon name={icon} filled={isActive} size={20} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function SideNav() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showHelp, setShowHelp] = useState(false);
  const [showTestAs, setShowTestAs] = useState(false);
  const canTestAsUser = user?.role === "super_admin" && !user?.impersonator;
  // Sit below the fixed impersonation banner (h-8) when one is showing.
  const impersonating = Boolean(user?.impersonator);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const navItems = [
    ...BASE_NAV,
    ...(["admin", "super_admin"].includes(user?.role) ? [ADMIN_NAV] : []),
    ...(user?.role === "super_admin" ? [SUPER_ADMIN_NAV] : []),
    ...(user?.role === "super_admin" || user?.canViewLeads ? [LEADS_NAV] : []),
    ...(user?.role === "super_admin" || user?.canEditMarking ? [MARKING_NAV] : []),
  ];

  return (
    <nav
      className={`hidden md:flex flex-col w-64 fixed left-0 py-md px-sm border-r border-outline-variant bg-surface-container-low z-40 ${
        impersonating ? "top-8 h-[calc(100vh-2rem)]" : "top-0 h-screen"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-sm px-sm mb-xl">
        <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0 text-on-primary">
          <Icon name="domain" filled />
        </div>
        <div className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-sm min-w-0">
            <span className="font-headline-sm text-headline-sm text-primary truncate">
              OMR GradePro
            </span>
          </div>
          <span className="font-body-sm text-body-sm text-on-surface-variant truncate">
            Academic Session 2026-2027
          </span>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={() => navigate("/exams/new")}
        className="mb-xl mx-sm py-sm px-md bg-primary-container text-on-primary rounded-xl font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors shadow-sm flex items-center justify-center gap-sm"
      >
        <Icon name="add" size={18} />
        New Exam
      </button>

      {/* Main nav */}
      <div className="flex-1 space-y-sm">
        {navItems.map((n) => (
          <Item key={n.to} {...n} />
        ))}
      </div>

      {/* Footer nav */}
      <div className="space-y-xs border-t border-outline-variant pt-sm">
        {canTestAsUser && showTestAs && <TestAsUser onClose={() => setShowTestAs(false)} />}
        {user && (
          <div className="flex items-center gap-sm px-md py-sm">
            {user.picture ? (
              <img
                src={user.picture}
                alt=""
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-cover border border-outline-variant shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
                <Icon name="person" size={18} filled />
              </div>
            )}
            <div className="flex flex-col overflow-hidden">
              <span className="font-body-md text-body-md text-on-surface truncate">{user.name}</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant truncate">
                {user.email}
              </span>
            </div>
          </div>
        )}
        {canTestAsUser && (
          <button
            onClick={() => setShowTestAs((s) => !s)}
            className="w-full flex items-center gap-md px-md py-sm text-on-surface-variant hover:bg-surface-container-high rounded-xl font-label-md text-label-md transition-all duration-200"
            title="View the portal as another user"
          >
            <Icon name="switch_account" size={20} />
            <span>Test as User</span>
          </button>
        )}
        <button
          onClick={() => setShowHelp((s) => !s)}
          className="w-full flex items-center gap-md px-md py-sm text-on-surface-variant hover:bg-surface-container-high rounded-xl font-label-md text-label-md transition-all duration-200"
          title="Contact support"
        >
          <Icon name="help" size={20} />
          <span>Help Center</span>
        </button>
        {showHelp && (
          <div className="mx-md mb-xs px-md py-sm rounded-xl bg-surface-container-high">
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-xs">
              Need help? Email us at:
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=OMR%20GradePro%20Support`}
              className="font-body-sm text-body-sm text-primary break-all hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-md px-md py-sm text-on-surface-variant hover:bg-surface-container-high rounded-xl font-label-md text-label-md transition-all duration-200"
        >
          <Icon name="logout" size={20} />
          <span>Logout</span>
        </button>
      </div>
    </nav>
  );
}
