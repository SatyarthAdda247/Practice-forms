import { NavLink, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { useAuth } from "../auth.jsx";

const BASE_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { to: "/exams", label: "Exams", icon: "assignment" },
  { to: "/upload", label: "Uploads", icon: "cloud_upload" },
  { to: "/results", label: "Results", icon: "analytics" },
  { to: "/form-filler", label: "Form Filler", icon: "edit_note" },
];
const ADMIN_NAV = { to: "/admin", label: "Administrator", icon: "admin_panel_settings" };
const SETTINGS_NAV = { to: "/settings", label: "Settings", icon: "settings" };

function Item({ to, label, icon }) {
  return (
    <NavLink
      to={to}
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

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const navItems = [
    ...BASE_NAV,
    ...(["admin", "super_admin"].includes(user?.role) ? [ADMIN_NAV] : []),
    SETTINGS_NAV,
  ];

  return (
    <nav className="hidden md:flex flex-col h-screen w-64 fixed left-0 top-0 py-md px-sm border-r border-outline-variant bg-surface-container-low z-40">
      {/* Header */}
      <div className="flex items-center gap-sm px-sm mb-xl">
        <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0 text-on-primary">
          <Icon name="domain" filled />
        </div>
        <div className="flex flex-col overflow-hidden">
          <span className="font-headline-sm text-headline-sm text-primary truncate">
            Admin Dashboard
          </span>
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
        Process New Batch
      </button>

      {/* Main nav */}
      <div className="flex-1 space-y-sm">
        {navItems.map((n) => (
          <Item key={n.to} {...n} />
        ))}
      </div>

      {/* Footer nav */}
      <div className="space-y-xs border-t border-outline-variant pt-sm">
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
        <a
          href="#"
          className="flex items-center gap-md px-md py-sm text-on-surface-variant hover:bg-surface-container-high rounded-xl font-label-md text-label-md transition-all duration-200"
        >
          <Icon name="help" size={20} />
          <span>Help Center</span>
        </a>
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
