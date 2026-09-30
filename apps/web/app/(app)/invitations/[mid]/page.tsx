import { Invitation } from "@/components/members/invitation";

export default async function InvitationPage({ params }: { params: Promise<{ mid: string }> }) {
  return <Invitation mid={(await params).mid} />;
}
