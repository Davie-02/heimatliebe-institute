import { generateTempPassword, TEMP_PASSWORD_LENGTH } from "./temp-password";
import { passwordProblems } from "./password-policy";

describe("generateTempPassword", () => {
  it("makes long, mixed, policy-passing and unique passwords", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const password = generateTempPassword();
      expect(password).toHaveLength(TEMP_PASSWORD_LENGTH);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[2-9]/);
      expect(password).toMatch(/[!@#$%^&*\-_=+?]/);
      expect(password).not.toMatch(/[0O1lI]/);
      expect(passwordProblems(password)).toEqual([]);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
  });
});
