interface Props {
  className?: string;
}

export default function MultiSigBrandMark({ className = 'h-9 w-14' }: Props) {
  return (
    <img
      src="/brand/mst-primary.svg"
      alt=""
      aria-hidden="true"
      className={`${className} shrink-0 object-contain`}
    />
  );
}
