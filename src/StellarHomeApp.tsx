import StellarDashboardApp from './StellarDashboardApp';
import StellarLandingApp from './StellarLandingApp';
import StellarTestnetLandingApp from './StellarTestnetLandingApp';
import { useStellarWallet } from './StellarWalletContext';
import { fixedClientStellarDeploymentNetwork } from './stellar/deploymentNetwork';

export default function StellarHomeApp() {
  const { sessionAddress } = useStellarWallet();
  if (sessionAddress) return <StellarDashboardApp />;
  return fixedClientStellarDeploymentNetwork() === 'testnet' ? <StellarTestnetLandingApp /> : <StellarLandingApp />;
}
