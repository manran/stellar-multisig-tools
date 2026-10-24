interface Props {
  className?: string;
}

export default function MultiSigBrandMark({ className = 'h-9 w-10' }: Props) {
  return (
    <img
      src="/brand/mst-app-icon.svg"
      alt=""
      aria-hidden="true"
      className={`${className} shrink-0 object-contain`}
    />
  );
}
