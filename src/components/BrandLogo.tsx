type BrandLogoProps = {
  className: string;
};

export default function BrandLogo({ className }: BrandLogoProps) {
  return (
    <span className={`${className} brand-logo-frame`}>
      <img src="/logo.jpeg" alt="" aria-hidden="true" />
    </span>
  );
}
