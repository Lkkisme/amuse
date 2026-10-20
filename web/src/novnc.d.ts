/** @types/novnc__novnc still names the old entry (lib/rfb); 1.7 exports the same class from the package root. */
declare module "@novnc/novnc" {
  import RFB from "@novnc/novnc/lib/rfb";
  export default RFB;
}
