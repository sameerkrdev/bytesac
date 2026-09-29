import Image from "next/image";
export function Logo({ size = 40 }: { size?: number }) {
  return <Image src="/logo.png" alt="Bytesac" width={size} height={size} priority />;
}
