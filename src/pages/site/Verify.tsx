import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHero } from "./PageHero";
import { Alert, Button, ErrorNote, TextField } from "@/components/ui";
import { usePageMeta } from "@/hooks/useData";
import { api } from "@/services/api";
import { date } from "@/lib/format";

interface Certificate { certificateNo: string; holderName: string; course: string; level: string | null; grade: string | null; hours: number | null; issuedAt: string; valid: boolean }

/** Employers and universities can check that a Heimatliebe certificate is genuine. */
export default function Verify() {
  const params = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(params.code ?? "");
  const [result, setResult] = useState<Certificate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  usePageMeta("Verify a certificate");

  async function check(value: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.get<Certificate>(`/public/certificates/${encodeURIComponent(value.trim())}`));
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (params.code) void check(params.code);
  }, [params.code]);

  function submit(event: FormEvent) {
    event.preventDefault();
    navigate(`/verify/${encodeURIComponent(code.trim())}`);
  }

  return (
    <div className="page-enter">
      <PageHero title="Verify a certificate" intro="Enter the verification code or certificate number printed on the certificate." />
      <section className="section">
        <div className="narrow stack">
          <form className="form-card row" onSubmit={submit} style={{ alignItems: "flex-end" }}>
            <TextField label="Verification code or certificate number" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required className="" />
            <Button type="submit" loading={busy} style={{ marginBottom: "1rem" }}>Check</Button>
          </form>
          <ErrorNote error={error} />
          {result && (
            <div className="form-card">
              <Alert tone={result.valid ? "success" : "danger"}>{result.valid ? "This certificate is genuine." : "This certificate has been revoked and is no longer valid."}</Alert>
              <table className="table">
                <tbody>
                  <tr><th>Holder</th><td>{result.holderName}</td></tr>
                  <tr><th>Course</th><td>{result.course}{result.level ? ` (${result.level})` : ""}</td></tr>
                  {result.grade && <tr><th>Grade</th><td>{result.grade}</td></tr>}
                  {result.hours ? <tr><th>Teaching hours</th><td>{result.hours}</td></tr> : null}
                  <tr><th>Issued</th><td>{date(result.issuedAt)}</td></tr>
                  <tr><th>Certificate number</th><td className="mono">{result.certificateNo}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
