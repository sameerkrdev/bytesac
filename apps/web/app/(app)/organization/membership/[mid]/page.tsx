import { MembershipPage } from "@/components/members/membership-profile";

export default async function OrganizationMembershipPage({ params }: { params: Promise<{ mid: string }> }) {
  return <MembershipPage mid={(await params).mid} />;
}
