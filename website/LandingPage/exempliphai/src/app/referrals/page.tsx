import { redirect } from "next/navigation";

export default function ReferralsPage() {
  redirect("/account?tab=referrals");
}
