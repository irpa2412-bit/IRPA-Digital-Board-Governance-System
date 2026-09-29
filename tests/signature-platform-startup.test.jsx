import React from "react";
import {render,screen} from "@testing-library/react";
import {describe,it,expect,vi} from "vitest";

let uploadProps;

vi.mock("../src/components/ControlledDocumentUpload",()=>({
  default:(props)=>{
    uploadProps=props;
    return <div data-testid="controlled-upload">Controlled upload</div>;
  }
}));
vi.mock("../src/pages/SignaturePlatform",()=>({
  default:()=> <div data-testid="signature-platform">Signature Platform</div>
}));

describe("SignaturePlatformWithUpload startup contract",()=>{
  it("renders without throwing and supplies the upload callbacks/props expected by ControlledDocumentUpload",async()=>{
    const {default:SignaturePlatformWithUpload}=await import("../src/pages/SignaturePlatformWithUpload.jsx");
    expect(()=>render(<SignaturePlatformWithUpload/>)).not.toThrow();
    expect(screen.getByTestId("controlled-upload")).toBeTruthy();
    expect(uploadProps).toMatchObject({
      purpose:"Signature Source Document",
      deferSave:true,
      showSaveButton:true,
      submitLabel:"Upload Document"
    });
    expect(typeof uploadProps.onUploaded).toBe("function");
    expect(uploadProps.onSave).toBeUndefined();
  });
});
