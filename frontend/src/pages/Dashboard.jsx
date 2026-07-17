import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useAuth } from "../auth.jsx";

// Tool cards shown in the bento grid. `to` is null for tools without a page yet.
const TOOLS = [
  {
    to: null,
    icon: "photo_size_select_large",
    title: "Image Resizer",
    blurb:
      "Format your photos and signatures exactly to IBPS/SBI specifications. Avoid rejection.",
    cta: "Resize Now",
    iconWrap: "bg-primary-container text-on-primary",
    ctaColor: "text-primary",
    corner: "bg-primary-container/20",
  },
  {
    to: "/key-checker",
    icon: "fact_check",
    title: "Key Checker",
    blurb:
      "Instantly verify your OMR or digital responses against official answer keys to calculate scores.",
    cta: "Check Key",
    iconWrap: "bg-tertiary-container text-on-tertiary",
    ctaColor: "text-tertiary",
    corner: "bg-tertiary-container/10",
  },
  {
    to: "/form-filler",
    icon: "edit_note",
    title: "Pre Form-Filler",
    blurb:
      "Draft and validate your application details for IBPS PO before actual submission.",
    cta: "Start Draft",
    iconWrap: "bg-secondary-container text-on-secondary-container",
    ctaColor: "text-on-secondary-fixed-variant",
    corner: "bg-secondary-container/30",
  },
];

const ACTIVITY = [
  {
    icon: "photo_size_select_large",
    iconWrap: "bg-primary-container text-on-primary",
    title: "Resized Signature",
    detail: "for SBI Clerk Application",
    when: "2 hours ago",
    badge: { text: "Success", className: "bg-[#d1fae5] text-[#065f46]" },
  },
  {
    icon: "fact_check",
    iconWrap: "bg-tertiary-container text-on-tertiary",
    title: "Checked Answer Key",
    detail: "for IBPS PO Mock Test #4",
    when: "Yesterday, 4:30 PM",
    note: "Score: 68/100",
  },
  {
    icon: "edit_note",
    iconWrap: "bg-secondary-container text-on-secondary-container",
    title: "Drafted Form",
    detail: "for RBI Assistant Prelims",
    when: "Oct 12, 2023",
    badge: { text: "Draft", className: "bg-[#fef3c7] text-[#92400e]" },
  },
];

const DEADLINES = [
  {
    title: "IBPS PO Form Submission",
    detail: "Last date: Tomorrow, 11:59 PM",
    accent: "border-error",
    action: "Complete Now",
  },
  {
    title: "SBI Clerk Admit Card",
    detail: "Expected release: 24 Oct",
    accent: "border-primary",
  },
  {
    title: "RBI Grade B Phase 1",
    detail: "Exam Date: 15 Nov",
    accent: "border-outline-variant",
  },
];

function ToolCard({ tool }) {
  const inner = (
    <>
      <div
        className={`absolute top-0 right-0 w-32 h-32 ${tool.corner} rounded-bl-full -z-10 transition-transform group-hover:scale-110`}
      />
      <div className={`w-12 h-12 ${tool.iconWrap} rounded-lg flex items-center justify-center mb-md`}>
        <Icon name={tool.icon} size={24} />
      </div>
      <h3 className="font-headline-md text-headline-md text-on-surface mb-xs">{tool.title}</h3>
      <p className="font-body-sm text-body-sm text-on-surface-variant mb-lg">{tool.blurb}</p>
      <span
        className={`flex items-center gap-xs font-label-md text-label-md ${tool.ctaColor} group-hover:translate-x-1 transition-transform`}
      >
        {tool.cta} <Icon name="arrow_forward" size={18} />
      </span>
    </>
  );

  const className =
    "bg-surface-container-lowest border border-outline-variant rounded-xl p-lg hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-shadow group relative overflow-hidden block";

  return tool.to ? (
    <Link to={tool.to} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] || "Aspirant";

  return (
    <div className="space-y-xl w-full">
      {/* Welcome header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-md">
        <div>
          <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface">
            Welcome back, {firstName}
          </h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
            Your exam preparation toolkit is ready. What would you like to do today?
          </p>
        </div>
        <div className="flex items-center gap-sm text-on-surface-variant font-label-sm text-label-sm bg-surface-container-lowest px-md py-sm rounded-full border border-outline-variant">
          <Icon name="calendar_today" size={16} />
          <span>Next Exam: IBPS PO Prelims (14 Days)</span>
        </div>
      </div>

      {/* Core tools grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-lg">
        {TOOLS.map((tool) => (
          <ToolCard key={tool.title} tool={tool} />
        ))}
      </div>

      {/* Bottom section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg">
        {/* Recent activity */}
        <div className="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-lg">
          <div className="flex justify-between items-center mb-md border-b border-outline-variant pb-sm">
            <h3 className="font-headline-md text-headline-md text-on-surface">Recent Activity</h3>
            <button className="text-primary font-label-sm text-label-sm hover:underline">
              View All
            </button>
          </div>
          <div>
            {ACTIVITY.map((item, i) => (
              <div
                key={item.title}
                className={`flex items-start gap-md py-md hover:bg-surface-bright transition-colors px-sm -mx-sm rounded-lg ${
                  i < ACTIVITY.length - 1 ? "border-b border-surface-variant" : ""
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full ${item.iconWrap} flex items-center justify-center flex-shrink-0 mt-1`}
                >
                  <Icon name={item.icon} size={16} />
                </div>
                <div className="flex-1">
                  <p className="font-body-sm text-body-sm text-on-surface">
                    <span className="font-medium">{item.title}</span> {item.detail}
                  </p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant mt-xs">
                    {item.when}
                  </p>
                </div>
                {item.badge ? (
                  <span
                    className={`px-2 py-1 ${item.badge.className} text-[10px] font-bold uppercase tracking-wider rounded`}
                  >
                    {item.badge.text}
                  </span>
                ) : (
                  <span className="font-label-sm text-label-sm text-on-surface-variant">
                    {item.note}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming deadlines */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg flex flex-col">
          <div className="flex justify-between items-center mb-md border-b border-outline-variant pb-sm">
            <h3 className="font-headline-md text-headline-md text-on-surface">Deadlines</h3>
            <Icon name="event" size={20} className="text-on-surface-variant" />
          </div>
          <div className="flex-1 space-y-md">
            {DEADLINES.map((d) => (
              <div
                key={d.title}
                className={`bg-surface-container p-md rounded-lg border-l-4 ${d.accent}`}
              >
                <p className="font-label-md text-label-md text-on-surface">{d.title}</p>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs">{d.detail}</p>
                {d.action && (
                  <button className="mt-sm text-xs font-semibold text-error hover:underline flex items-center gap-1">
                    {d.action} <Icon name="arrow_forward" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
