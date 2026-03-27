"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ReferralsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/account?tab=referrals");
  }, [router]);

  return null;
}
