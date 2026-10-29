class Veng < Formula
  desc "Luyện thì tiếng Anh trong terminal — dịch Việt → Anh, AI chấm"
  homepage "https://github.com/nmvuong92/veng"
  url "https://github.com/nmvuong92/veng/releases/download/v0.13.3/veng-0.13.3.tgz"
  sha256 "2c6e15d6febfbeae716a1e6fdf8b2955da904dabb0b10d05b114ca5dfbd23bae"
  license "MIT"

  depends_on "node"

  def install
    libexec.install "veng.mjs"
    (bin/"veng").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/veng.mjs" "$@"
    SH
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/veng --version")
  end
end
