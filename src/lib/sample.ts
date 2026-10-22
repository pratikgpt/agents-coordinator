import type { CompanyRules } from "./schemas";

// Fictional company and meeting. Deliberately contains a holiday clash, a rule-breaking
// suggestion (skip security review), a conflict (refresh cadence) and an unowned item.
export const SAMPLE_TRANSCRIPT = `Northwind Analytics — Bluefin Grocers churn dashboard kickoff
Date: Monday 2026-10-19. Attendees: Asha Rao, Dev Patel, Mei Lin, Sara Ortiz.

Sara: Bluefin wants the churn dashboard live for their regional managers. They asked for Friday the 30th.
Asha: Okay, let's commit to releasing v1 to Bluefin's production environment on 2026-10-30.
Dev: I'll build the ingestion pipeline from their POS exports. I can have it done by Friday the 23rd.
Mei: I'll own validation of the churn model. Target is Monday the 26th, assuming Dev's pipeline lands first.
Mei: For customer matching I'd like to use the raw customer emails from their CRM extract.
Sara: I don't think we have anything in writing from Bluefin about sharing emails yet.
Dev: Honestly, it's just a dashboard. We could skip the security review this time to hit the date.
Asha: Refresh cadence — we agreed daily refresh in the proposal.
Sara: Bluefin told me last week they only need a weekly refresh.
Asha: Someone also needs to build the PDF export the managers asked for. Not sure who has capacity.
Sara: I'll handle the client training session after launch, sometime the week of November 2nd.
Asha: Tom wasn't here today, but he will need to know about this release.`;

export const SAMPLE_RULES: CompanyRules = {
  company: "Northwind Analytics",
  meeting_date: "2026-10-19",
  working_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  holidays: ["2026-10-30"],
  roster: [
    { name: "Asha Rao", role: "Engineering Lead", max_open_tasks: 4 },
    { name: "Dev Patel", role: "Data Engineer", max_open_tasks: 3 },
    { name: "Mei Lin", role: "Analyst", max_open_tasks: 3 },
    { name: "Tom Becker", role: "Security Lead", max_open_tasks: 2 },
    { name: "Sara Ortiz", role: "Account Manager", max_open_tasks: 3 },
  ],
  rules: [
    { id: "R1", text: "Every task has exactly one owner from the roster, or is left unassigned with an open question. Never invent people." },
    { id: "R2", text: "Any release to a client production environment requires a security review owned by the Security Lead, finished at least 2 working days before the release." },
    { id: "R3", text: "Deadlines must fall on working days and never on a company holiday." },
    { id: "R4", text: "Client-facing deliverables need Account Manager sign-off before delivery." },
    { id: "R5", text: "Nobody may own more tasks than their max_open_tasks." },
    { id: "R6", text: "Client PII (names, emails, phone numbers) may only be used with written client approval on record; otherwise use the anonymised dataset." },
  ],
};
