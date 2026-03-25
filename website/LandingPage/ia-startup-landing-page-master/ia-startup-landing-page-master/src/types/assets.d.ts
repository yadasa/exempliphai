declare module "*.png" {
  const value: string;
  export default value;
}

declare module "*.svg?url" {
  const src: {
    src: string;
  };
  export default src;
}
