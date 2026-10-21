import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIVATE_V4, PRIVATE_V6, egressRules, gatewayOf, hasV6, missingRules, range } from "./egress.ts";

const net = { subnet: "10.231.250.0/24", gateway: "10.231.250.1", v6: false };

/** The -A lines of a rule set, without the chain's name. */
const rulesOf = (set: string) =>
  set
    .split("\n")
    .filter((line) => line.startsWith("-A AMUSE_EGRESS "))
    .map((line) => line.slice("-A AMUSE_EGRESS ".length));

test("IPv4: loopback and replies first, then everything private is refused, then the public internet", () => {
  const { v4 } = egressRules(net);
  assert.match(v4, /^\*filter\n:AMUSE_EGRESS - \[0:0\]\n-A OUTPUT -j AMUSE_EGRESS\n/);
  assert.ok(v4.endsWith("COMMIT\n"));
  const rules = rulesOf(v4);
  const reject = "-j REJECT --reject-with icmp-port-unreachable";
  assert.deepEqual(rules.slice(0, 3), ["-o lo -j ACCEPT", "-d 127.0.0.11/32 -j ACCEPT", "-m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"]);
  assert.deepEqual(rules.slice(3, 5), [`-d 10.231.250.1/32 ${reject}`, `-d 10.231.250.0/24 ${reject}`], "the host's gateway and this network itself");
  for (const to of [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "100.64.0.0/10",
    "169.254.0.0/16",
    "127.0.0.0/8",
    "0.0.0.0/8",
    "224.0.0.0/4",
    "240.0.0.0/4",
  ])
    assert.ok(rules.includes(`-d ${to} ${reject}`), to);
  assert.equal(rules.at(-1), "-j ACCEPT", "the rest is the public internet");
  assert.equal(rules.filter((rule) => rule.includes("REJECT")).length, 2 + PRIVATE_V4.length);
  assert.ok(!rules.slice(0, -1).some((rule) => rule === "-j ACCEPT"), "nothing is let through before the private ranges are refused");
});

test("the gateway and the network are optional, and a range is named by its first address", () => {
  assert.equal(rulesOf(egressRules({ subnet: null, gateway: null, v6: false }).v4).filter((rule) => rule.includes("REJECT")).length, PRIVATE_V4.length);
  assert.ok(rulesOf(egressRules({ ...net, subnet: "172.30.1.77/24" }).v4).includes("-d 172.30.1.0/24 -j REJECT --reject-with icmp-port-unreachable"));
  assert.equal(range("10.231.250.0/24"), "10.231.250.0/24");
  assert.equal(range("10.231.250.200/25"), "10.231.250.128/25");
  assert.equal(range("0.0.0.0/0"), "0.0.0.0/0");
  assert.equal(range("255.255.255.255/32"), "255.255.255.255/32");
});

test("what is put into the rules is an address, never a command or a flag", () => {
  for (const bad of ["", "10.0.0.0", "10.0.0.0/33", "10.0.0.0/x", "10.0.0.0/8/1", "300.0.0.1/8", "10.0.0.0/8 -j ACCEPT", "fc00::/7", "-j ACCEPT"])
    assert.throws(() => egressRules({ ...net, subnet: bad }), /not an IPv4 address range/, bad);
  for (const bad of ["10.231.250.1 -j ACCEPT", "gateway", "fe80::1", "10.231.250.1/32", ""])
    assert.throws(() => egressRules({ ...net, gateway: bad }), /not an IPv4 address/, bad);
});

test("IPv6: with none on the network nothing leaves that way; with some, the private ranges are refused and neighbours still found", () => {
  const off = rulesOf(egressRules(net).v6);
  assert.deepEqual(off, ["-o lo -j ACCEPT", "-m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT", "-j REJECT --reject-with icmp6-port-unreachable"]);
  const on = rulesOf(egressRules({ ...net, v6: true }).v6);
  assert.deepEqual(on.slice(0, 2), ["-o lo -j ACCEPT", "-m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"]);
  assert.ok(on.includes("-p ipv6-icmp --icmpv6-type 135 -j ACCEPT"));
  for (const to of PRIVATE_V6) assert.ok(on.includes(`-d ${to} -j REJECT --reject-with icmp6-port-unreachable`), to);
  assert.equal(on.at(-1), "-j ACCEPT");
  assert.ok(on.indexOf("-j ACCEPT") === on.length - 1 || !on.slice(0, -1).includes("-j ACCEPT"));
  for (const to of ["fc00::/7", "fe80::/10", "::1/128"]) assert.ok(PRIVATE_V6.includes(to), to);
});

test("the rules are checked against what the kernel lists, in order, and what is missing is named", () => {
  const { v4 } = egressRules(net);
  const listing = [
    "-P INPUT ACCEPT",
    "-P FORWARD ACCEPT",
    "-P OUTPUT ACCEPT",
    "-N AMUSE_EGRESS",
    "-A OUTPUT -j AMUSE_EGRESS",
    ...v4.split("\n").filter((line) => line.startsWith("-A AMUSE_EGRESS ")),
  ].join("\n");
  assert.deepEqual(missingRules(v4, listing), []);
  assert.deepEqual(
    missingRules(v4, ""),
    v4.split("\n").filter((line) => line.startsWith("-A ")),
    "an empty table has none of them",
  );
  const lacking = missingRules(v4, listing.replace("-A AMUSE_EGRESS -d 192.168.0.0/16 -j REJECT --reject-with icmp-port-unreachable\n", ""));
  assert.deepEqual(lacking, ["-A AMUSE_EGRESS -d 192.168.0.0/16 -j REJECT --reject-with icmp-port-unreachable"]);
  // a final ACCEPT before the refusals would let everything through: out of order counts as missing
  const early = listing
    .replace("-A AMUSE_EGRESS -j ACCEPT", "")
    .replace("-A AMUSE_EGRESS -o lo -j ACCEPT", "-A AMUSE_EGRESS -j ACCEPT\n-A AMUSE_EGRESS -o lo -j ACCEPT");
  assert.ok(missingRules(v4, early).length > 0);
});

test("the gateway is read from the kernel's routes, and IPv6 from its addresses", () => {
  const route = [
    "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
    "eth0\t00000000\t01FAE70A\t0003\t0\t0\t0\t00000000\t0\t0\t0",
    "eth0\t00FAE70A\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0",
    "",
  ].join("\n");
  assert.equal(gatewayOf(route), "10.231.250.1");
  assert.equal(gatewayOf("Iface\tDestination\tGateway\tFlags\neth0\t00FAE70A\t00000000\t0001\n"), null, "no default route");
  assert.equal(gatewayOf(""), null);
  const lo = "00000000000000000000000000000001 01 80 10 80       lo\n";
  assert.deepEqual(hasV6(lo), { global: false, any: false });
  assert.deepEqual(hasV6(`${lo}fe80000000000000000000000000abcd 05 40 20 80     eth0\n`), { global: false, any: true });
  assert.deepEqual(hasV6(`${lo}fd000000000000000000000000000002 05 40 00 80     eth0\n`), { global: true, any: true });
});
