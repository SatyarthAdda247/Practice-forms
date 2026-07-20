import { useNavigate } from "react-router-dom";
import SideNav from "./SideNav.jsx";
import BottomNav from "./BottomNav.jsx";
import Icon from "./Icon.jsx";
import BetaBadge from "./BetaBadge.jsx";
import { useAuth } from "../auth.jsx";

// App shell: fixed side nav on desktop; on mobile a sticky top app bar plus a
// bottom tab bar, with the content column capped at the design's max width.
export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="bg-background text-on-surface min-h-screen flex">
      <SideNav />

      {/* Mobile top app bar */}
      <header className="md:hidden flex justify-between items-center h-16 px-lg w-full fixed top-0 z-40 bg-surface border-b border-outline-variant">
        <div className="flex items-center gap-sm">
          <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary shrink-0">
            <Icon name="domain" filled size={20} />
          </div>
          <span className="font-headline-sm text-headline-sm text-primary tracking-tight">
            OMR GradePro
          </span>
          <BetaBadge className="shrink-0" />
        </div>
        <div className="flex items-center gap-sm">
          <button className="text-primary p-xs rounded-full hover:bg-surface-container transition-colors">
            <Icon name="notifications" />
          </button>
          {user &&
            (user.picture ? (
              <img
                src={user.picture}
                alt=""
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-cover border border-outline-variant"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center">
                <Icon name="person" size={18} filled />
              </div>
            ))}
          <button
            onClick={handleLogout}
            title="Log out"
            className="text-primary p-xs rounded-full hover:bg-surface-container transition-colors"
          >
            <Icon name="logout" />
          </button>
        </div>
      </header>

      <main className="flex-1 md:ml-64 p-lg md:p-xl flex flex-col max-w-container-max mx-auto w-full mt-16 md:mt-0 pb-24 md:pb-xl">
        {children}
      </main>

      <BottomNav />
    </div>
  );
}
