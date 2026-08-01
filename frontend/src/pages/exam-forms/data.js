// ─── src/pages/exam-forms/data.js ────────────────────────────────────────────
// Single source of truth for exam form catalogue data.
// Add new exams here — the landing page picks them up automatically.

import {
  IBPSLogo,
  SBILogo,
  RBILogo,
  SSCLogo,
  RRBLogo,
  LICLogo,
} from "../../components/GovtLogos.jsx";

export const CATEGORIES = [
  {
    id: "Banking",
    label: "Banking & Insurance",
    icon: "account_balance",
    color: "#1A237E",
  },
  {
    id: "SSC",
    label: "SSC & Railways",
    icon: "train",
    color: "#B91C1C",
  },
  {
    id: "Teaching",
    label: "Teaching & State PCS",
    icon: "school",
    color: "#065F46",
  },
];

export const EXAMS = [
  // ── Banking ──────────────────────────────────────────────────────
  {
    id: "IBPS-PO",
    title: "IBPS PO",
    fullName: "IBPS PO (CRP PO/MT-XVI)",
    orgName: "Institute of Banking Personnel Selection",
    category: "Banking",
    LogoComponent: IBPSLogo,
    isAvailable: true,
    route: "/exam-forms/IBPS-PO",
    officialSite: "https://ibps.in",
  },
  {
    id: "IBPS-CLERK",
    title: "IBPS Clerk",
    fullName: "IBPS Clerk XIV",
    orgName: "Institute of Banking Personnel Selection",
    category: "Banking",
    LogoComponent: IBPSLogo,
    isAvailable: false,
    route: "#",
    officialSite: "https://ibps.in",
  },
  {
    id: "SBI-PO",
    title: "SBI PO",
    fullName: "SBI PO 2026",
    orgName: "State Bank of India",
    category: "Banking",
    LogoComponent: SBILogo,
    isAvailable: false,
    route: "#",
    officialSite: "https://sbi.co.in",
  },
  {
    id: "SBI-CLERK",
    title: "SBI Clerk",
    fullName: "SBI Junior Associate (JA)",
    orgName: "State Bank of India",
    category: "Banking",
    LogoComponent: SBILogo,
    isAvailable: false,
    route: "#",
    officialSite: "https://sbi.co.in",
  },
  {
    id: "RBI-GRADE-B",
    title: "RBI Grade B",
    fullName: "RBI Grade B Officer 2026",
    orgName: "Reserve Bank of India",
    category: "Banking",
    LogoComponent: RBILogo,
    isAvailable: false,
    route: "#",
    officialSite: "https://opportunities.rbi.org.in",
  },
  {
    id: "LIC-AAO",
    title: "LIC AAO",
    fullName: "LIC Assistant Administrative Officer",
    orgName: "Life Insurance Corporation",
    category: "Banking",
    LogoComponent: LICLogo,
    isAvailable: false,
    route: "#",
    officialSite: "https://licindia.in",
  },
  // ── SSC & Railways ───────────────────────────────────────────────
  {
    id: "SSC-CGL",
    title: "SSC CGL",
    fullName: "SSC CGL Tier-I 2026",
    orgName: "Staff Selection Commission",
    category: "SSC",
    LogoComponent: SSCLogo,
    isAvailable: false,
    route: "#",
    officialSite: "https://ssc.gov.in",
  },
  {
    id: "RRB-NTPC",
    title: "RRB NTPC",
    fullName: "RRB NTPC Graduate Posts",
    orgName: "Railway Recruitment Board",
    category: "SSC",
    LogoComponent: RRBLogo,
    isAvailable: false,
    route: "#",
    officialSite: "https://indianrailways.gov.in",
  },
];
