import { useAuth } from "../auth/AuthContext";
import { RequesterDashboardScreen } from "./RequesterDashboardScreen";
import { StaffDashboardScreen } from "./StaffDashboardScreen";

/**
 * `/dashboard` for every role (lab-04 ui-spec.md §2): the session's role
 * picks the variant, so a user can never ask for another role's dashboard
 * by URL. IT Staff and Administrator share the staff variant.
 */
export function DashboardScreen() {
  const { user } = useAuth();
  if (user?.role === "REQUESTER") return <RequesterDashboardScreen />;
  return <StaffDashboardScreen />;
}
