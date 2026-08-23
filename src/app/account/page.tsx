import type { Metadata } from "next";
import AccountView from "@/components/AccountView";

export const metadata: Metadata = {
  title: "Your account · Third Degree",
  description: "Your streak, your queue and your shelf, kept across devices.",
};

export default function AccountPage() {
  return <AccountView />;
}
