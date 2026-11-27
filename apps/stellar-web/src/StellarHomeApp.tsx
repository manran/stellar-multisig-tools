import { lazy } from 'react';
import StellarLandingApp from './StellarLandingApp';
import StellarTestnetLandingApp from './StellarTestnetLandingApp';
import { useStellarWallet } from './StellarWalletContext';
import { fixedClientStellarDeploymentNetwork } from '../../../packages/stellar-core/src/deploymentNetwork';

const StellarDashboardApp = lazy(() => import('./StellarDashboardApp'));

export default function StellarHomeApp() {
  const { sessionAddress } = useStellarWallet();
  if (sessionAddress) return <StellarDashboardApp />;
  return fixedClientStellarDeploymentNetwork() === 'testnet' ? <StellarTestnetLandingApp /> : <StellarLandingApp />;
}
