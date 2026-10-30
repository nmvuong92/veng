class Veng < Formula
  desc "Luyện thì tiếng Anh trong terminal — dịch Việt → Anh, AI chấm"
  homepage "https://github.com/nmvuong92/veng"
  url "https://github.com/nmvuong92/veng/releases/download/v0.29.0/veng-0.29.0.tgz"
  sha256 "181bd07d2ae19af74ac64d8bf30d6f4418b90d85523b7e6cec532d83921d0e5a"
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
