import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// QR version 40-L can carry 2,953 bytes in byte mode. Keep a small safety margin
// so a single static code remains reliably encodable across scanners.
export const MAX_SINGLE_QR_BYTES = 2_850;

export function xdrFitsSingleQr(xdr: string): boolean {
  return new TextEncoder().encode(xdr).byteLength <= MAX_SINGLE_QR_BYTES;
}

export default function XdrQrCode({ xdr }: { xdr: string }) {
  const [dataUrl, setDataUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setDataUrl('');
    setError('');

    if (!xdr) return () => { active = false; };
    if (!xdrFitsSingleQr(xdr)) {
      setError('This transaction is too large for one reliable QR code. Use Copy XDR instead.');
      return () => { active = false; };
    }

    void QRCode.toDataURL(xdr, {
      errorCorrectionLevel: 'L',
      margin: 4,
      width: 420,
      color: { dark: '#111111ff', light: '#ffffffff' },
    }).then((url) => {
      if (active) setDataUrl(url);
    }).catch(() => {
      if (active) setError('Unable to render this transaction as a QR code. Use Copy XDR instead.');
    });

    return () => { active = false; };
  }, [xdr]);

  if (error) {
    return <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-sm text-amber-800 dark:text-amber-200">{error}</div>;
  }

  if (!dataUrl) {
    return <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">Preparing QR code…</div>;
  }

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mx-auto w-fit rounded-xl bg-white p-2">
        <img src={dataUrl} width={280} height={280} alt="QR code containing the exact Stellar transaction XDR" className="h-auto w-[280px] max-w-full" />
      </div>
      <p className="mx-auto mt-3 max-w-md text-center text-xs leading-5 text-neutral-500 dark:text-neutral-400">Scan this with an offline signer. The QR contains transaction data only; it never contains a secret key. After signing, add the signed XDR back to this Proposal.</p>
    </div>
  );
}
