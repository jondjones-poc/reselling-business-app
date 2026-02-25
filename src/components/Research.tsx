import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLocation } from 'react-router-dom';
import './BrandResearch.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

// Load mensResaleReference from JSON file
let mensResaleReference: Array<{
  brand: string;
  status: string;
  note: string;
  categories: Array<{ item: string; resaleRange: string }>;
}> = [];

// Fallback array (kept for reference)
const mensResaleReferenceFallback = [
  {
    brand: "AllSaints",
    status: "✅",
    note: "Premium menswear — leather, knits, denim move fast.",
    categories: [
      { item: "Outerwear", resaleRange: "£60–£120" },
      { item: "Knitwear", resaleRange: "£40–£70" },
      { item: "Denim", resaleRange: "£40–£70" }
    ]
  },
  {
    brand: "Aligne",
    status: "❌",
    note: "Womenswear focused; no mens resale market.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "AMI Paris",
    status: "✅",
    note: "Modern French designer with loyal buyers.",
    categories: [
      { item: "Sweatshirts", resaleRange: "£60–£100" },
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Knitwear", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "A.P.C.",
    status: "✅",
    note: "French minimalist; premium selvedge denim holds strong value.",
    categories: [
      { item: "Denim", resaleRange: "£60–£100" },
      { item: "Jackets", resaleRange: "£70–£120" }
    ]
  },
  {
    brand: "Aquascutum",
    status: "✅",
    note: "British heritage tailoring and trench coats.",
    categories: [
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Suits", resaleRange: "£100–£180" }
    ]
  },
  {
    brand: "Arket",
    status: "✅",
    note: "High-quality minimalist menswear from H&M Group's premium line.",
    categories: [
      { item: "Coats", resaleRange: "£60–£100" },
      { item: "Knitwear", resaleRange: "£40–£70" },
      { item: "Shirts", resaleRange: "£30–£50" }
    ]
  },
  {
    brand: "Arc'teryx",
    status: "✅",
    note: "Technical outdoor wear with cult resale base.",
    categories: [{ item: "Outerwear", resaleRange: "£100–£200" }]
  },
  {
    brand: "Atmosphere",
    status: "❌",
    note: "Primark sub-brand; zero resale interest.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Banana Republic",
    status: "⚠️",
    note: "Buy only tailored wool coats or chinos; most slow sellers.",
    categories: [{ item: "Outerwear", resaleRange: "£30–£60" }]
  },
  {
    brand: "Baracuta",
    status: "✅",
    note: "Iconic G9 Harrington jacket; UK classic resale hit.",
    categories: [{ item: "Outerwear", resaleRange: "£70–£120" }]
  },
  {
    brand: "Barbour",
    status: "✅",
    note: "UK heritage label; wax and quilted jackets resell fast.",
    categories: [{ item: "Outerwear", resaleRange: "£80–£150" }]
  },
  {
    brand: "Barbour Beacon",
    status: "⚠️",
    note: "Cheaper Barbour range; slower sales, lower quality.",
    categories: [{ item: "Outerwear", resaleRange: "£25–£50" }]
  },
  {
    brand: "Barbour International",
    status: "✅",
    note: "Popular biker sub-line; solid resale for jackets/gilets.",
    categories: [{ item: "Outerwear", resaleRange: "£60–£100" }]
  },
  {
    brand: "Barbour Gold Standard",
    status: "✅",
    note: "Collector range; high demand and resale prices.",
    categories: [{ item: "Outerwear", resaleRange: "£120–£200" }]
  },
  {
    brand: "Belstaff",
    status: "✅",
    note: "Luxury moto outerwear; jackets flip quickly £100+.",
    categories: [{ item: "Outerwear", resaleRange: "£100–£250" }]
  },
  {
    brand: "Ben Sherman",
    status: "⚠️",
    note: "Retro Mod appeal; vintage shirts worth it only.",
    categories: [{ item: "Shirts", resaleRange: "£20–£35" }]
  },
  {
    brand: "Bershka",
    status: "❌",
    note: "Youth fast fashion; poor quality, low resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Blue Harbour",
    status: "❌",
    note: "M&S sub-line, dated and low demand.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "BoohooMAN",
    status: "❌",
    note: "Ultra-fast fashion; flooded market.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Brakeburn",
    status: "⚠️",
    note: "Casual coastal wear; only if mint condition.",
    categories: [
      { item: "Shirts", resaleRange: "£15–£25" },
      { item: "Knitwear", resaleRange: "£20–£30" }
    ]
  },
  {
    brand: "Burton",
    status: "❌",
    note: "Defunct high street label; weak resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Calvin Klein Jeans",
    status: "⚠️",
    note: "Only premium denim or heavy-logo sweats sell.",
    categories: [
      { item: "Denim", resaleRange: "£25–£40" },
      { item: "Sweatshirts", resaleRange: "£25–£35" }
    ]
  },
  {
    brand: "Carhartt WIP",
    status: "✅",
    note: "Workwear/streetwear crossover; reliable resale base.",
    categories: [
      { item: "Jackets", resaleRange: "£60–£100" },
      { item: "Workwear", resaleRange: "£40–£80" },
      { item: "Cargo", resaleRange: "£35–£60" }
    ]
  },
  {
    brand: "Charles Tyrwhitt",
    status: "⚠️",
    note: "Common businesswear; only limited or luxury cotton shirts move.",
    categories: [{ item: "Shirts", resaleRange: "£25–£40" }]
  },
  {
    brand: "Cheaney",
    status: "✅",
    note: "Heritage Northampton shoemaker; handmade leather boots.",
    categories: [
      { item: "Shoes", resaleRange: "£90–£150" },
      { item: "Boots", resaleRange: "£100–£160" }
    ]
  },
  {
    brand: "Church's",
    status: "✅",
    note: "Top-end English dress shoes with collector appeal.",
    categories: [{ item: "Shoes", resaleRange: "£120–£200" }]
  },
  {
    brand: "CP Company",
    status: "✅",
    note: "Italian technical streetwear; strong resale market.",
    categories: [
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Sweatshirts", resaleRange: "£50–£100" }
    ]
  },
  {
    brand: "Crockett & Jones",
    status: "✅",
    note: "Luxury UK-made footwear; elite resale value.",
    categories: [{ item: "Shoes", resaleRange: "£120–£250" }]
  },
  {
    brand: "Cotton On",
    status: "❌",
    note: "Low-cost fast fashion; poor resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Crew Clothing",
    status: "❌",
    note: "Too common on resale platforms.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Diesel",
    status: "✅",
    note: "Premium Italian denim; made-in-Italy lines resell well.",
    categories: [
      { item: "Denim", resaleRange: "£40–£80" },
      { item: "Jackets", resaleRange: "£50–£100" }
    ]
  },
  {
    brand: "Dr. Martens Made in England",
    status: "✅",
    note: "Strong resale, collector appeal. Avoid Asia-made lines.",
    categories: [{ item: "Boots", resaleRange: "£60–£120" }]
  },
  {
    brand: "Dune Mens",
    status: "✅",
    note: "Real leather shoes £25–£50 resale; skip synthetic pairs.",
    categories: [{ item: "Shoes", resaleRange: "£25–£50" }]
  },
  {
    brand: "Eton Shirts",
    status: "✅",
    note: "Swedish premium shirtmaker; fast resale £40–£80.",
    categories: [{ item: "Shirts", resaleRange: "£40–£80" }]
  },
  {
    brand: "Filson",
    status: "✅",
    note: "US heritage outdoor gear; jackets sell £80–£150.",
    categories: [
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Bags", resaleRange: "£60–£100" }
    ]
  },
  {
    brand: "French Connection",
    status: "❌",
    note: "Overproduced; little resale interest.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "GANT",
    status: "✅",
    note: "Premium preppy; polos and knits have steady resale.",
    categories: [
      { item: "Knitwear", resaleRange: "£30–£60" },
      { item: "Shirts", resaleRange: "£25–£45" }
    ]
  },
  {
    brand: "Grenson",
    status: "✅",
    note: "Premium British shoe brand; good market base.",
    categories: [
      { item: "Shoes", resaleRange: "£80–£150" },
      { item: "Boots", resaleRange: "£90–£160" }
    ]
  },
  {
    brand: "Hackett",
    status: "✅",
    note: "Upper-tier British casualwear, steady resale.",
    categories: [
      { item: "Shirts", resaleRange: "£30–£50" },
      { item: "Jackets", resaleRange: "£60–£100" }
    ]
  },
  {
    brand: "H&M",
    status: "❌",
    note: "Mass-market, oversaturated.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Jaeger",
    status: "✅",
    note: "British tailoring, wool coats and suits resell well.",
    categories: [
      { item: "Suits", resaleRange: "£60–£120" },
      { item: "Outerwear", resaleRange: "£70–£130" }
    ]
  },
  {
    brand: "John Smedley",
    status: "✅",
    note: "Luxury knitwear brand; Merino & Sea Island cotton strong.",
    categories: [{ item: "Knitwear", resaleRange: "£50–£90" }]
  },
  {
    brand: "Lacoste",
    status: "✅",
    note: "Polos and knitwear resell quickly.",
    categories: [
      { item: "Polos", resaleRange: "£25–£50" },
      { item: "Knitwear", resaleRange: "£30–£60" }
    ]
  },
  {
    brand: "Levi's",
    status: "✅",
    note: "Heritage denim. Vintage or 501s sell fast.",
    categories: [
      { item: "Denim", resaleRange: "£30–£70" },
      { item: "Jackets", resaleRange: "£50–£80" }
    ]
  },
  {
    brand: "Loake",
    status: "✅",
    note: "Northampton heritage shoemaker; solid resale.",
    categories: [{ item: "Shoes", resaleRange: "£60–£120" }]
  },
  {
    brand: "Patagonia",
    status: "✅",
    note: "Outdoor brand with high resale £50–£100.",
    categories: [
      { item: "Outerwear", resaleRange: "£70–£120" },
      { item: "Fleeces", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Paul Smith",
    status: "✅",
    note: "British designer, shirts & shoes strong resale.",
    categories: [
      { item: "Shirts", resaleRange: "£50–£90" },
      { item: "Shoes", resaleRange: "£70–£130" }
    ]
  },
  {
    brand: "Ralph Lauren (Standard)",
    status: "✅",
    note: "Core polos & knits steady resale.",
    categories: [
      { item: "Polos", resaleRange: "£25–£40" },
      { item: "Knitwear", resaleRange: "£30–£50" }
    ]
  },
  {
    brand: "Reiss",
    status: "✅",
    note: "Premium high-street tailoring.",
    categories: [
      { item: "Suits", resaleRange: "£70–£120" },
      { item: "Shirts", resaleRange: "£30–£60" }
    ]
  },
  {
    brand: "RM Williams",
    status: "✅",
    note: "Australian Chelsea boots; cult following.",
    categories: [{ item: "Shoes", resaleRange: "£100–£180" }]
  },
  {
    brand: "Stone Island",
    status: "✅",
    note: "Cult label, fast resale turnover.",
    categories: [
      { item: "Outerwear", resaleRange: "£100–£200" },
      { item: "Sweatshirts", resaleRange: "£60–£120" }
    ]
  },
  {
    brand: "Ted Baker",
    status: "✅",
    note: "Premium tailoring & footwear resale well.",
    categories: [
      { item: "Suits", resaleRange: "£60–£120" },
      { item: "Shoes", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Timberland",
    status: "✅",
    note: "Boots & jackets move fast £40–£100.",
    categories: [
      { item: "Shoes", resaleRange: "£50–£100" },
      { item: "Outerwear", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Tommy Hilfiger",
    status: "✅",
    note: "Classic brand; polos & jackets £25–£60.",
    categories: [
      { item: "Polos", resaleRange: "£25–£50" },
      { item: "Outerwear", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Tricker's",
    status: "✅",
    note: "Heritage British shoemaker; high-end resale.",
    categories: [{ item: "Shoes", resaleRange: "£90–£150" }]
  },
  {
    brand: "Turnbull & Asser",
    status: "✅",
    note: "Savile Row shirtmaker; luxury resale.",
    categories: [{ item: "Shirts", resaleRange: "£80–£150" }]
  },
  {
    brand: "Whistles Mens",
    status: "✅",
    note: "Premium menswear; wool coats & knits resell.",
    categories: [
      { item: "Outerwear", resaleRange: "£60–£100" },
      { item: "Knitwear", resaleRange: "£40–£70" }
    ]
  },
  {
    brand: "Wrangler",
    status: "✅",
    note: "Western/workwear denim, steady demand.",
    categories: [
      { item: "Denim", resaleRange: "£25–£45" },
      { item: "Jackets", resaleRange: "£30–£60" }
    ]
  },
  {
    brand: "Zara",
    status: "❌",
    note: "Fast fashion, oversaturated resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  }
];

// Convert status emoji to status type
const getStatusFromEmoji = (status: string): 'good' | 'bad' | 'warning' => {
  if (status === "✅") return 'good';
  if (status === "❌") return 'bad';
  if (status === "⚠️") return 'warning';
  return 'bad';
};

interface CategoryItem {
  item: string;
  resaleRange: string;
}

interface TypeaheadResult {
  name: string;
  status: 'good' | 'bad' | 'warning';
  note?: string;
  categories?: CategoryItem[];
}

const Research: React.FC = () => {
  const location = useLocation();
  
  // Offline/Brand search state
  const [searchText, setSearchText] = useState('');
  const [typeaheadResults, setTypeaheadResults] = useState<TypeaheadResult[]>([]);
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [lookupBrands, setLookupBrands] = useState<string[]>([]);
  const [selectedLookupBrand, setSelectedLookupBrand] = useState('');

  // AI Research state
  const [researchText, setResearchText] = useState('');
  const [researchImages, setResearchImages] = useState<string[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchResult, setResearchResult] = useState<string | null>(null);

  // Brand Website state
  const [brandsWithWebsites, setBrandsWithWebsites] = useState<Array<{ id: number; brand_name: string; brand_website: string | null }>>([]);
  const [selectedBrandForWebsite, setSelectedBrandForWebsite] = useState<number | ''>('');

  const compressImage = (file: File, maxWidth: number = 1920, maxHeight: number = 1920, quality: number = 0.8): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Calculate new dimensions
          if (width > height) {
            if (width > maxWidth) {
              height = (height * maxWidth) / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = (width * maxHeight) / height;
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert to base64 with compression
          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedDataUrl);
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    const remainingSlots = 4 - researchImages.length;
    if (remainingSlots <= 0) {
      setResearchError('Maximum 4 images allowed');
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    
    // Validate all files
    for (const file of filesToProcess) {
      if (!file.type.startsWith('image/')) {
        setResearchError('Please upload only image files');
        return;
      }
    }

    setResearchError(null);
    setResearchLoading(true);

    try {
      const compressedImages: string[] = [];
      
      for (const file of filesToProcess) {
        // Check file size (warn if over 10MB before compression)
        if (file.size > 10 * 1024 * 1024) {
          console.warn('Image is very large, compressing...', file.name);
        }
        
        const compressedImage = await compressImage(file);
        compressedImages.push(compressedImage);
      }

      setResearchImages((prev) => [...prev, ...compressedImages]);
      setResearchError(null);
    } catch (err: any) {
      setResearchError(err.message || 'Failed to process image file');
    } finally {
      setResearchLoading(false);
      // Reset the input so the same file can be selected again
      event.target.value = '';
    }
  };

  const removeImage = (index: number) => {
    setResearchImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCameraCapture = async () => {
    if (researchImages.length >= 4) {
      setResearchError('Maximum 4 images allowed');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } // Prefer back camera on mobile
      });
      
      // Create a video element to show the camera feed
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      
      // Create a modal/overlay for camera preview
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 20px;
      `;
      
      const videoContainer = document.createElement('div');
      videoContainer.style.cssText = `
        width: 90%;
        max-width: 640px;
        position: relative;
      `;
      
      video.style.cssText = `
        width: 100%;
        height: auto;
        border-radius: 12px;
      `;
      
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = `
        display: flex;
        gap: 12px;
        justify-content: center;
      `;
      
      const captureButton = document.createElement('button');
      captureButton.textContent = '📷 Capture';
      captureButton.style.cssText = `
        padding: 16px 32px;
        font-size: 18px;
        border-radius: 999px;
        border: 2px solid #8cffc3;
        background: rgba(140, 255, 195, 0.2);
        color: #8cffc3;
        cursor: pointer;
        font-weight: 600;
      `;
      
      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'Cancel';
      cancelButton.style.cssText = `
        padding: 16px 32px;
        font-size: 18px;
        border-radius: 999px;
        border: 2px solid rgba(255, 120, 120, 0.5);
        background: rgba(255, 120, 120, 0.2);
        color: #ff9a9a;
        cursor: pointer;
        font-weight: 600;
      `;
      
      const capturePhoto = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          canvas.toBlob(async (blob) => {
            if (blob) {
              const file = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' });
              try {
                const compressedImage = await compressImage(file);
                setResearchImages((prev) => [...prev, compressedImage]);
                setResearchError(null);
              } catch (err: any) {
                setResearchError(err.message || 'Failed to process photo');
              }
            }
            // Cleanup
            stream.getTracks().forEach(track => track.stop());
            document.body.removeChild(modal);
          }, 'image/jpeg', 0.9);
        }
      };
      
      const cancelCapture = () => {
        stream.getTracks().forEach(track => track.stop());
        document.body.removeChild(modal);
      };
      
      captureButton.onclick = capturePhoto;
      cancelButton.onclick = cancelCapture;
      
      videoContainer.appendChild(video);
      buttonContainer.appendChild(captureButton);
      buttonContainer.appendChild(cancelButton);
      modal.appendChild(videoContainer);
      modal.appendChild(buttonContainer);
      document.body.appendChild(modal);
      
      // Wait for video to be ready
      video.onloadedmetadata = () => {
        video.play();
      };
      
    } catch (err: any) {
      console.error('Camera access error:', err);
      setResearchError('Unable to access camera. Please check permissions or use file upload instead.');
    }
  };

  const handleResearchSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!researchText.trim() && researchImages.length === 0) {
      setResearchError('Please enter text or upload at least one image');
      return;
    }

    setResearchLoading(true);
    setResearchError(null);
    setResearchResult(null);

    try {
      const requestBody = {
        text: researchText.trim() || undefined,
        images: researchImages.length > 0 ? researchImages : []
      };
      
      console.log('Sending research request:', {
        hasText: !!requestBody.text,
        textLength: requestBody.text?.length || 0,
        imagesCount: requestBody.images.length,
        imagesAreArray: Array.isArray(requestBody.images)
      });

      const response = await fetch(`${API_BASE}/api/gemini/research`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to process research request' }));
        throw new Error(errorData.error || 'Failed to process research request');
      }

      const data = await response.json();
      setResearchResult(data.result);
    } catch (err: any) {
      console.error('Gemini research error:', err);
      setResearchError(err.message || 'Unable to process research request. Please try again later.');
    } finally {
      setResearchLoading(false);
    }
  };

  const clearResearch = () => {
    setResearchText('');
    setResearchImages([]);
    setResearchResult(null);
    setResearchError(null);
  };

  // Offline/Brand search functionality
  useEffect(() => {
    if (!searchText.trim()) {
      setTypeaheadResults([]);
      setShowTypeahead(false);
      return;
    }

    const searchTerm = searchText.toLowerCase().trim();
    const results: TypeaheadResult[] = [];

    // Search mensResaleReference (comprehensive source)
    mensResaleReference.forEach((item) => {
      if (item.brand.toLowerCase().includes(searchTerm)) {
        results.push({
          name: item.brand,
          status: getStatusFromEmoji(item.status),
          note: item.note,
          categories: item.categories
        });
      }
    });

    setTypeaheadResults(results.slice(0, 10));
    setShowTypeahead(results.length > 0);
  }, [searchText]);

  // Handle Escape key to close typeahead and clear text
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showTypeahead) {
          setShowTypeahead(false);
        }
        setSearchText('');
        setSelectedLookupBrand('');
        setTypeaheadResults([]);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [showTypeahead]);

  useEffect(() => {
    // Load mensResaleReference from API
    const loadMensResaleReference = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/mens-resale-reference`);
        if (response.ok) {
          const data = await response.json();
          mensResaleReference.length = 0;
          mensResaleReference.push(...data);
          console.log(`Loaded ${mensResaleReference.length} brands from API`);
          
          // Populate lookup brands from mensResaleReference (all brands)
          const allBrandsList = mensResaleReference
            .map(item => item.brand)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
          setLookupBrands(allBrandsList);
        }
      } catch (error) {
        console.warn('Failed to load mensResaleReference from API, using fallback:', error);
        // Use fallback array if API fails
        mensResaleReference.length = 0;
        mensResaleReference.push(...mensResaleReferenceFallback);
        const allBrandsList = mensResaleReferenceFallback
          .map(item => item.brand)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        setLookupBrands(allBrandsList);
      }
    };

    loadMensResaleReference();
  }, []);

  // Clear text box when navigating away or menu is clicked
  useEffect(() => {
    const clearOnNavigation = () => {
      setSearchText('');
      setSelectedLookupBrand('');
      setTypeaheadResults([]);
      setShowTypeahead(false);
    };

    // Clear when location changes (navigation)
    clearOnNavigation();
  }, [location.pathname]);

  // Load brands with websites
  useEffect(() => {
    const loadBrandsWithWebsites = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/brands`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Raw API response:', data);
          const brands = Array.isArray(data.rows) ? data.rows : [];
          console.log(`Loaded ${brands.length} brands from API`);
          // Log a specific brand to check brand_website field
          if (brands.length > 0) {
            const firstBrand = brands[0];
            console.log('First brand object:', firstBrand);
            console.log('First brand keys:', Object.keys(firstBrand));
            console.log('First brand brand_website:', firstBrand.brand_website);
            // Check if it's a different case
            console.log('First brand all properties:', JSON.stringify(firstBrand, null, 2));
          }
          setBrandsWithWebsites(brands);
        } else {
          console.error('Failed to load brands - response not OK:', response.status, response.statusText);
        }
      } catch (err) {
        console.error('Failed to load brands with websites:', err);
      }
    };

    loadBrandsWithWebsites();
  }, []);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(event.target.value);
    setSelectedLookupBrand('');
  };

  const handleTypeaheadClick = (brandName: string) => {
    setSearchText(brandName);
    setShowTypeahead(false);
  };

  const handleLookupBrandChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = event.target.value;
    setSelectedLookupBrand(selected);
    if (selected) {
      setSearchText(selected);
    }
  };


  const handleCopyToClipboard = async (brandName: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const textToCopy = String(brandName).trim();
    
    try {
      await navigator.clipboard.writeText(textToCopy);
      
      const button = e.currentTarget;
      const originalText = button.innerHTML;
      button.innerHTML = '✓';
      button.style.color = '#60ff9f';
      setTimeout(() => {
        button.innerHTML = originalText;
        button.style.color = '';
      }, 1000);
    } catch (err) {
      console.error('Failed to copy:', err);
      try {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        const button = e.currentTarget;
        const originalText = button.innerHTML;
        button.innerHTML = '✓';
        button.style.color = '#60ff9f';
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.color = '';
        }, 1000);
      } catch (fallbackErr) {
        console.error('Fallback copy also failed:', fallbackErr);
      }
    }
  };

  // AI Research functionality
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = window.localStorage.getItem('saerch term');
      const trimmed = stored ? stored.trim() : '';

      if (!trimmed) {
        return;
      }

      setResearchText((current) => (current.trim().length > 0 ? current : trimmed));
    } catch (storageError) {
      console.warn('Unable to read stored search term for research:', storageError);
    }
  }, []);


  return (
    <div className="research-page-container">
      {/* Brand Search Section */}
      <div className="brand-research-container">
        <div className="search-section">
          <div className="search-input-container" style={{ position: 'relative' }}>
            <input
              type="text"
              value={searchText}
              onChange={handleSearchChange}
              onFocus={() => {
                if (typeaheadResults.length > 0) {
                  setShowTypeahead(true);
                }
              }}
              onBlur={() => {
                setTimeout(() => setShowTypeahead(false), 200);
              }}
              placeholder="Search brands..."
              className="brand-search-input"
              autoComplete="off"
            />
            {showTypeahead && typeaheadResults.length > 0 && (
              <div className="brand-results-dropdown" onClick={() => setShowTypeahead(false)}>
                <div 
                  className="brand-results-dropdown-content" 
                  onClick={(e) => {
                    if (window.innerWidth <= 768) {
                      setShowTypeahead(false);
                    } else {
                      e.stopPropagation();
                    }
                  }}
                >
                  {typeaheadResults.map((result, index) => {
                    const brandName = result.name;
                    return (
                      <div
                        key={`${result.name}-${index}`}
                        className={`brand-result-item ${result.status}`}
                        onMouseDown={(e) => {
                          if ((e.target as HTMLElement).closest('.copy-brand-button')) {
                            return;
                          }
                          e.preventDefault();
                          handleTypeaheadClick(brandName);
                        }}
                        onTouchStart={(e) => {
                          if ((e.target as HTMLElement).closest('.copy-brand-button')) {
                            return;
                          }
                          e.preventDefault();
                          handleTypeaheadClick(brandName);
                        }}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('.copy-brand-button')) {
                            return;
                          }
                          if (window.innerWidth <= 768) {
                            handleTypeaheadClick(brandName);
                          }
                        }}
                      >
                        <div className="result-brand-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                            <span className="result-brand">{brandName}</span>
                            <button
                              type="button"
                              onClick={(e) => handleCopyToClipboard(brandName, e)}
                              onMouseDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              className="copy-brand-button"
                              title="Copy brand name to clipboard"
                              aria-label={`Copy ${brandName} to clipboard`}
                            >
                              📋
                            </button>
                          </div>
                          <span className={`result-status-tag ${result.status === 'good' ? 'good-tag' : result.status === 'warning' ? 'warning-tag' : 'avoid-tag'}`}>
                            {result.status === 'good' ? 'Good' : result.status === 'warning' ? 'Warning' : 'Avoid'}
                          </span>
                        </div>
                        {result.note && (
                          <div className="result-note">{result.note}</div>
                        )}
                        {result.categories && result.categories.length > 0 && (
                          <div className="result-categories-list">
                            {result.categories.map((cat, catIndex) => (
                              <div key={catIndex} className="result-category-row">
                                <span className="category-item">{cat.item}</span>
                                <span className="category-range">{cat.resaleRange}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Brands Lookup Tool Section */}
      <div className="brand-lookup-container">
        <h2 className="brand-lookup-heading">Brands Lookup Tool</h2>
        <div className="brand-lookup-form">
          {lookupBrands.length > 0 && (
            <select
              value={selectedLookupBrand}
              onChange={handleLookupBrandChange}
              className="brand-lookup-select"
            >
              <option value="">Select a brand...</option>
              {lookupBrands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          )}
          {selectedLookupBrand && (() => {
            // Find brand in mensResaleReference for status, note, and categories
            const brandData = mensResaleReference.find(item => 
              item.brand.toLowerCase().trim() === selectedLookupBrand.toLowerCase().trim()
            );
            
            // Find brand in brandsWithWebsites for website URL
            const selectedBrand = brandsWithWebsites.find(b => 
              b.brand_name.toLowerCase().trim() === selectedLookupBrand.toLowerCase().trim()
            );
            
            if (!brandData) {
              return null;
            }
            
            const status = getStatusFromEmoji(brandData.status);
            
            return (
              <div className="brand-lookup-result">
                <div className={`brand-result-item ${status}`}>
                  <div className="result-brand-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                      <span className="result-brand">{selectedLookupBrand}</span>
                      <button
                        type="button"
                        onClick={(e) => handleCopyToClipboard(selectedLookupBrand, e)}
                        className="copy-brand-button"
                        title="Copy brand name to clipboard"
                        aria-label={`Copy ${selectedLookupBrand} to clipboard`}
                      >
                        📋
                      </button>
                    </div>
                    <span className={`result-status-tag ${status === 'good' ? 'good-tag' : status === 'warning' ? 'warning-tag' : 'avoid-tag'}`}>
                      {status === 'good' ? 'Good' : status === 'warning' ? 'Warning' : 'Avoid'}
                    </span>
                  </div>
                  {brandData.note && (
                    <div className="result-note">{brandData.note}</div>
                  )}
                  {brandData.categories && brandData.categories.length > 0 && (
                    <div className="result-categories-list">
                      {brandData.categories.map((cat, catIndex) => (
                        <div key={catIndex} className="result-category-row">
                          <span className="category-item">{cat.item}</span>
                          <span className="category-range">{cat.resaleRange}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedBrand && selectedBrand.brand_website && (
                    <div className="brand-website-link-container" style={{ marginTop: '12px' }}>
                      <a
                        href={selectedBrand.brand_website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="brand-website-link"
                      >
                        {selectedBrand.brand_website}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* AI Research Section */}
      <div className="research-tool-container">
        <h2 className="research-section-heading">AI Research</h2>
        <form onSubmit={handleResearchSubmit} className="research-tool-form">
          <div className="research-input-group">
            <textarea
              value={researchText}
              onChange={(e) => setResearchText(e.target.value)}
              placeholder="Enter item description or search query..."
              className="research-text-input"
              rows={1}
            />
            <div className="research-image-upload">
              <div className="image-upload-buttons">
                <button
                  type="button"
                  onClick={handleCameraCapture}
                  className="image-upload-label camera-label"
                  disabled={researchImages.length >= 4}
                >
                  📷 Take Photo
                </button>
                <label htmlFor="research-image-file" className="image-upload-label file-label">
                  📁 Choose Files
                </label>
                <input
                  id="research-image-file"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="image-upload-input"
                  disabled={researchImages.length >= 4}
                />
              </div>
              {researchImages.length > 0 && (
                <div className="images-count-indicator">
                  {researchImages.length}/4 images selected
                </div>
              )}
              {researchImages.length > 0 && (
                <div className="images-preview-container">
                  {researchImages.map((image, index) => (
                    <div key={index} className="image-preview">
                      <img src={image} alt={`Preview ${index + 1}`} />
                      <button
                        type="button"
                        onClick={() => removeImage(index)}
                        className="remove-image-button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="research-actions">
            <button
              type="submit"
              className="research-submit-button"
              disabled={researchLoading || (!researchText.trim() && researchImages.length === 0)}
            >
              {researchLoading ? 'Researching...' : 'Research Item'}
            </button>
            {(researchText || researchImages.length > 0 || researchResult) && (
              <button
                type="button"
                onClick={clearResearch}
                className="research-clear-button"
              >
                Clear
              </button>
            )}
          </div>

          {researchError && (
            <div className="research-error">{researchError}</div>
          )}

          {researchResult && (
            <div className="research-result">
              <div className="research-result-header">
                <div className="research-result-avatar">AI</div>
                <h3>Research Analysis</h3>
              </div>
              <div className="research-result-content">
                <ReactMarkdown>{researchResult}</ReactMarkdown>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* Brand Website Section */}
      <div className="brand-research-container">
        <div className="brand-website-section">
          <h3 className="brand-website-title">Brand Website</h3>
          <div className="brand-website-form">
            <div className="brand-website-dropdown-container">
              <select
                id="brand-website-select"
                value={selectedBrandForWebsite}
                onChange={(e) => setSelectedBrandForWebsite(e.target.value ? Number(e.target.value) : '')}
                className="brand-website-select"
              >
                <option value="">-- Select a brand --</option>
                {brandsWithWebsites.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.brand_name}
                  </option>
                ))}
              </select>
            </div>
            {selectedBrandForWebsite && (() => {
              const selectedBrand = brandsWithWebsites.find(b => b.id === Number(selectedBrandForWebsite));
              console.log('Selected brand:', selectedBrand);
              console.log('Brand website value:', selectedBrand?.brand_website);
              if (selectedBrand) {
                const websiteUrl = selectedBrand.brand_website;
                if (websiteUrl && typeof websiteUrl === 'string' && websiteUrl.trim() !== '') {
                  const trimmedUrl = websiteUrl.trim();
                  // Ensure URL has protocol
                  const fullUrl = trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://') 
                    ? trimmedUrl 
                    : `https://${trimmedUrl}`;
                  return (
                    <div className="brand-website-link-container">
                      <a
                        href={fullUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="brand-website-link"
                      >
                        {trimmedUrl}
                      </a>
                    </div>
                  );
                }
              }
              return null;
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Research;


