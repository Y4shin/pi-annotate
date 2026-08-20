{
  description = "pi-annotate dev shell with Playwright browsers provided by Nix";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          # The Node `playwright` library is installed by npm (see
          # devDependencies), but the browsers themselves come from Nix so we
          # never run `playwright install` (no network fetch at test time).
          # PLAYWRIGHT_BROWSERS_PATH points the library at the Nix-managed
          # browser store path; PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD keeps `npm
          # install` from trying to fetch its own copy.
          packages = with pkgs; [
            nodejs
            playwright
            playwright-driver
          ];
          env = {
            PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          };
        };
      });
    };
}
