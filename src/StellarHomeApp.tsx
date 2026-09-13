import StellarDashboardApp from './StellarDashboardApp';
import StellarLandingApp from './StellarLandingApp';
import { useStellarWallet } from './StellarWalletContext';

export default function StellarHomeApp() {
  const { sessionAddress } = useStellarWallet();
  return sessionAddress ? <StellarDashboardApp /> : <StellarLandingApp />;
}
