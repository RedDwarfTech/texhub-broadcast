export const enableDebug = () => {
   let debugFlag = localStorage.getItem("enableDebug");
   return debugFlag === "true";
};