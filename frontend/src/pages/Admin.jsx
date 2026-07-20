import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Icon from "../components/Icon.jsx";
import Loading from "../components/Loading.jsx";

function initials(name, email) {
  const base = (name || email || "?").trim();
  return base.slice(0, 2).toUpperCase();
}

function Avatar({ user }) {
  if (user.picture) {
    return (
      <img
        src={user.picture}
        alt=""
        referrerPolicy="no-referrer"
        className="w-10 h-10 rounded-full object-cover border border-outline-variant shrink-0"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-label-md text-label-md shrink-0">
      {initials(user.name, user.email)}
    </div>
  );
}

export default function Admin() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [adding, setAdding] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .adminListUsers()
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)
    );
  }, [users, query]);

  const act = async (id, fn) => {
    setPendingId(id);
    setError("");
    try {
      await fn();
      load();
    } catch (e) {
      setError(e.message);
      setPendingId(null);
    }
  };

  const isSuper = me.role === "super_admin";
  // Super-admins manage everyone; regular admins manage only members.
  const canManage = (u) => isSuper || (me.role === "admin" && u.role === "member");

  const addUser = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) {
      setError("Enter an email to add.");
      return;
    }
    setAdding(true);
    setError("");
    try {
      await api.adminCreateUser({ email, role: newRole });
      setNewEmail("");
      setNewRole("member");
      setShowAdd(false);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const changeRole = (u, role) => act(u.id, () => api.adminUpdateUser(u.id, { role }));
  const toggleActive = (u) => act(u.id, () => api.adminUpdateUser(u.id, { active: !u.active }));
  const removeUser = (u) => {
    if (!confirm(`Remove ${u.email}? They will lose access immediately.`)) return;
    act(u.id, () => api.adminDeleteUser(u.id));
  };

  const stats = {
    total: users.length,
    admins: users.filter((u) => u.role !== "member").length,
    revoked: users.filter((u) => !u.active).length,
  };

  return (
    <>
      <header className="mb-xl">
        <div className="flex items-center gap-sm mb-xs text-on-surface-variant">
          <Icon name="admin_panel_settings" size={18} />
          <span className="font-label-md text-label-md uppercase tracking-wider">Administrator</span>
        </div>
        <h1 className="font-headline-lg text-headline-lg text-on-background mb-xs">Manage Access</h1>
        <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
          Control who can use OMR GradePro. Sign-in is restricted to approved domains; you can
          promote admins or revoke access here.
        </p>
      </header>

      {error && (
        <div className="mb-lg p-md rounded-xl bg-error-container text-on-error-container font-body-md">
          {error}
        </div>
      )}

      {loading ? (
        <Loading />
      ) : (
        <>
      {/* Counts */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg flex justify-around items-center mb-xl">
        {[
          { k: "Users", v: stats.total },
          { k: "Admins", v: stats.admins },
          { k: "Revoked", v: stats.revoked, c: "text-error" },
        ].map((s) => (
          <div key={s.k} className="text-center">
            <div className={`font-data-mono text-headline-md font-bold ${s.c || "text-on-background"}`}>
              {s.v}
            </div>
            <div className="font-body-sm text-body-sm text-secondary">{s.k}</div>
          </div>
        ))}
      </div>

      {/* User list */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
        <div className="px-lg py-md border-b border-outline-variant bg-surface-bright flex flex-wrap gap-sm justify-between items-center">
          <h4 className="font-headline-sm text-headline-sm text-on-background">People ({rows.length})</h4>
          <div className="flex items-center gap-sm">
            <div className="relative">
              <Icon name="search" size={18} className="absolute left-sm top-1/2 -translate-y-1/2 text-outline" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name / email"
                className="bg-surface border border-outline-variant rounded-lg pl-xl pr-sm py-1.5 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
            {isSuper && (
              <button
                onClick={() => setShowAdd((s) => !s)}
                className="px-md py-1.5 bg-primary-container text-on-primary rounded-lg font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-xs shrink-0"
              >
                <Icon name="person_add" size={18} />
                <span className="hidden sm:inline">Add User</span>
              </button>
            )}
          </div>
        </div>

        {showAdd && isSuper && (
          <div className="px-lg py-md border-b border-outline-variant bg-surface flex flex-wrap gap-sm items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                Email
              </label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !adding && addUser()}
                placeholder="name@adda247.com"
                autoFocus
                className="w-full bg-surface border border-outline-variant rounded-lg px-sm py-1.5 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                Role
              </label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="bg-surface border border-outline-variant rounded-lg px-sm py-1.5 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary"
              >
                <option value="member">Member</option>
                {isSuper && <option value="admin">Admin</option>}
                {isSuper && <option value="super_admin">Super admin</option>}
              </select>
            </div>
            <button
              onClick={addUser}
              disabled={adding}
              className="px-lg py-1.5 bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors disabled:opacity-60"
            >
              {adding ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setNewEmail("");
              }}
              className="px-md py-1.5 border border-outline-variant rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              Cancel
            </button>
            <p className="w-full font-body-sm text-body-sm text-on-surface-variant">
              They can sign in immediately with their Google account on an allowed
              domain; this record links to it on first login.
            </p>
          </div>
        )}

        <ul className="divide-y divide-outline-variant">
            {rows.map((u) => {
              const isSelf = u.id === me.id;
              const busy = pendingId === u.id;
              return (
                <li
                  key={u.id}
                  className={`p-md flex flex-col sm:flex-row sm:items-center gap-md ${
                    !u.active ? "bg-error-container/10" : ""
                  }`}
                >
                  <div className="flex items-center gap-md flex-1 min-w-0">
                    <Avatar user={u} />
                    <div className="min-w-0">
                      <p className="font-body-md text-body-md text-on-background font-medium truncate">
                        {u.name} {isSelf && <span className="text-secondary font-normal">(you)</span>}
                      </p>
                      <p className="font-body-sm text-body-sm text-secondary truncate">{u.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-sm shrink-0">
                    <span
                      className={`font-label-md text-label-md px-sm py-xs rounded-full border ${
                        u.role === "super_admin"
                          ? "text-on-primary bg-primary border-primary"
                          : u.role === "admin"
                          ? "text-primary bg-primary-fixed border-primary-fixed-dim"
                          : "text-on-surface-variant bg-surface-variant border-outline-variant"
                      }`}
                    >
                      {u.role === "super_admin"
                        ? "Super admin"
                        : u.role === "admin"
                        ? "Admin"
                        : "Member"}
                    </span>
                    <span
                      className={`font-label-md text-label-md px-sm py-xs rounded-full border ${
                        u.active
                          ? "text-[#0d9488] bg-tertiary-fixed-dim/20 border-tertiary-fixed-dim"
                          : "text-error bg-error-container border-[#f87171]"
                      }`}
                    >
                      {u.active ? "Active" : "Revoked"}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-xs shrink-0">
                    {/* Role is changeable by super-admins only */}
                    {isSuper && (
                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u, e.target.value)}
                        disabled={isSelf || busy}
                        title="Change role"
                        className="px-sm py-xs rounded-lg border border-outline-variant bg-surface font-label-md text-label-md text-on-surface-variant focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-40"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="super_admin">Super admin</option>
                      </select>
                    )}
                    <button
                      onClick={() => toggleActive(u)}
                      disabled={isSelf || busy || !canManage(u)}
                      title={u.active ? "Revoke access" : "Restore access"}
                      className={`px-sm py-xs rounded-lg border font-label-md text-label-md transition-colors disabled:opacity-40 ${
                        u.active
                          ? "border-[#f87171] text-error hover:bg-error-container"
                          : "border-tertiary-fixed-dim text-[#0d9488] hover:bg-tertiary-fixed-dim/20"
                      }`}
                    >
                      {u.active ? "Revoke" : "Restore"}
                    </button>
                    {isSuper && (
                      <button
                        onClick={() => removeUser(u)}
                        disabled={isSelf || busy}
                        title="Delete user"
                        className="p-xs rounded-full text-outline hover:text-error hover:bg-error-container transition-colors disabled:opacity-40"
                      >
                        <Icon name="delete" size={20} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
      </div>
        </>
      )}
    </>
  );
}
